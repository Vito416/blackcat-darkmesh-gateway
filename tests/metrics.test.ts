import { describe, it, expect, beforeEach } from 'vitest'
import { inc, gauge, toProm, reset, snapshot } from '../src/metrics.js'

beforeEach(() => {
  reset()
})

describe('metrics exporter', () => {
  it('emits counters with _total suffix and HELP/TYPE', () => {
    inc('gateway_cache_hit')
    const prom = toProm()
    expect(prom).toContain('# HELP gateway_cache_hit_total Cache hits')
    expect(prom).toContain('# TYPE gateway_cache_hit_total counter')
    expect(prom).toMatch(/gateway_cache_hit_total 1/)
  })

  it('emits gauges with HELP/TYPE', () => {
    gauge('gateway_cache_size', 3)
    const prom = toProm()
    expect(prom).toContain('# HELP gateway_cache_size Cache entries currently stored')
    expect(prom).toContain('# TYPE gateway_cache_size gauge')
    expect(prom).toMatch(/gateway_cache_size 3/)
  })

  it('includes integrity incident/state metric descriptors', () => {
    const prom = toProm()
    expect(prom).toContain('# HELP gateway_cache_store_reject_total Cache entries rejected by admission limits')
    expect(prom).toContain('# HELP gateway_cache_store_reject_size_total Cache entries rejected for exceeding max entry bytes')
    expect(prom).toContain('# HELP gateway_cache_store_reject_capacity_total Cache entries rejected because cache is at max entries')
    expect(prom).toContain('# HELP gateway_ratelimit_pruned_total Rate-limit buckets pruned by expiry/cap')
    expect(prom).toContain('# HELP gateway_webhook_replay_pruned_total Replay detector keys pruned by expiry/cap')
    expect(prom).toContain('# HELP gateway_ratelimit_max_buckets Configured max rate-limit bucket count')
    expect(prom).toContain('# HELP gateway_webhook_replay_max_keys Configured replay detector max key count')
    expect(prom).toContain('# HELP gateway_cache_forget_forward_attempt_total Cache forget events attempted for worker forwarding')
    expect(prom).toContain('# HELP gateway_cache_forget_forward_success_total Cache forget events successfully forwarded to worker')
    expect(prom).toContain('# HELP gateway_cache_forget_forward_failed_total Cache forget events that failed worker forwarding')
    expect(prom).toContain('# HELP gateway_cache_forget_forward_timeout_total Cache forget events that timed out during worker forwarding')
    expect(prom).toContain('# HELP gateway_cache_forget_forward_skipped_total Cache forget events skipped because forwarding is not configured')
    expect(prom).toContain(
      '# HELP gateway_integrity_checkpoint_age_seconds Age of the last integrity checkpoint/snapshot audit in seconds',
    )
    expect(prom).toContain(
      '# HELP gateway_integrity_audit_seq_to Latest integrity audit sequence end observed by gateway',
    )
    expect(prom).toContain(
      '# HELP gateway_integrity_audit_stream_anomaly_total AO integrity audit stream anomalies detected (sequence regression or invalid ordering)',
    )
    expect(prom).toContain('# HELP gateway_integrity_incident_total Integrity incidents accepted by gateway')
    expect(prom).toContain(
      '# HELP gateway_integrity_incident_duplicate_total Integrity incidents detected as duplicate/idempotent replay',
    )
    expect(prom).toContain(
      '# HELP gateway_integrity_incident_role_blocked_total Integrity incident requests blocked by signature-ref role policy',
    )
    expect(prom).toContain('# HELP gateway_integrity_state_read_total Integrity state read requests served')
    expect(prom).toContain('# HELP gateway_integrity_state_auth_blocked_total Integrity state requests blocked by auth')
  })

  it('increments integrity audit stream anomaly counter on regression or invalid ordering', () => {
    gauge('gateway_integrity_audit_seq_from', 10)
    gauge('gateway_integrity_audit_seq_to', 12)
    expect(toProm()).not.toContain('gateway_integrity_audit_stream_anomaly_total 1')

    gauge('gateway_integrity_audit_seq_from', 11)
    gauge('gateway_integrity_audit_seq_to', 9)

    const state = snapshot()
    expect(state.counters.gateway_integrity_audit_stream_anomaly).toBe(1)
    expect(toProm()).toContain('# HELP gateway_integrity_audit_stream_anomaly_total AO integrity audit stream anomalies detected (sequence regression or invalid ordering)')
    expect(toProm()).toMatch(/gateway_integrity_audit_stream_anomaly_total 1/)
  })
})
