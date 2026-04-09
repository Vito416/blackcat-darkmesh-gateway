import { describe, it, expect, beforeEach } from 'vitest'
import { inc, gauge, toProm, reset } from '../src/metrics.js'

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
    expect(prom).toContain(
      '# HELP gateway_integrity_checkpoint_age_seconds Age of the last integrity checkpoint/snapshot audit in seconds',
    )
    expect(prom).toContain(
      '# HELP gateway_integrity_audit_seq_to Latest integrity audit sequence end observed by gateway',
    )
    expect(prom).toContain('# HELP gateway_integrity_incident_total Integrity incidents accepted by gateway')
    expect(prom).toContain(
      '# HELP gateway_integrity_incident_role_blocked_total Integrity incident requests blocked by signature-ref role policy',
    )
    expect(prom).toContain('# HELP gateway_integrity_state_read_total Integrity state read requests served')
    expect(prom).toContain('# HELP gateway_integrity_state_auth_blocked_total Integrity state requests blocked by auth')
  })
})
