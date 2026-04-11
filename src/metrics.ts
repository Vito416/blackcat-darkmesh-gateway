export type CounterMap = Record<string, number>
export type GaugeMap = Record<string, number>

type MetricState = { counters: CounterMap; gauges: GaugeMap }
const globalState: MetricState = (globalThis as any).__gatewayMetrics || { counters: {}, gauges: {} }
;(globalThis as any).__gatewayMetrics = globalState

const counters: CounterMap = globalState.counters
const gauges: GaugeMap = globalState.gauges

type IntegrityAuditStreamState = {
  lastSeqTo?: number
  seqFrom?: number
}

const auditStreamState: IntegrityAuditStreamState =
  (globalThis as any).__gatewayAuditStreamState || {}
;(globalThis as any).__gatewayAuditStreamState = auditStreamState

const help: Record<string, string> = {
  gateway_cache_hit_total: 'Cache hits',
  gateway_cache_miss_total: 'Cache misses',
  gateway_cache_expired_total: 'Cache entries expired',
  gateway_cache_swept_total: 'Cache entries removed by sweep',
  gateway_cache_store_reject_total: 'Cache entries rejected by admission limits',
  gateway_cache_store_reject_size_total: 'Cache entries rejected for exceeding max entry bytes',
  gateway_cache_store_reject_capacity_total: 'Cache entries rejected because cache is at max entries',
  gateway_cache_forget_forward_attempt_total: 'Cache forget events attempted for worker forwarding',
  gateway_cache_forget_forward_success_total: 'Cache forget events successfully forwarded to worker',
  gateway_cache_forget_forward_failed_total: 'Cache forget events that failed worker forwarding',
  gateway_cache_forget_forward_timeout_total: 'Cache forget events that timed out during worker forwarding',
  gateway_cache_forget_forward_skipped_total: 'Cache forget events skipped because forwarding is not configured',
  gateway_cache_size: 'Cache entries currently stored',
  gateway_cache_ttl_ms: 'Configured cache TTL (ms)',
  gateway_cache_max_entry_bytes: 'Configured cache max entry size (bytes)',
  gateway_cache_max_entries: 'Configured cache max entry count',
  gateway_inbox_accept_total: 'Inbox requests accepted',
  gateway_ratelimit_blocked_total: 'Requests blocked by rate limit',
  gateway_ratelimit_pruned_total: 'Rate-limit buckets pruned by expiry/cap',
  gateway_ratelimit_buckets: 'Active rate-limit buckets',
  gateway_ratelimit_max: 'Configured max requests per rate-limit window',
  gateway_ratelimit_max_buckets: 'Configured max rate-limit bucket count',
  gateway_ratelimit_override_count: 'Configured per-prefix rate-limit overrides',
  gateway_ratelimit_effective_max_last: 'Last effective rate-limit max selected for a checked key',
  gateway_metrics_auth_blocked_total: 'Unauthorized requests to /metrics',
  gateway_webhook_stripe_ok_total: 'Stripe webhooks verified',
  gateway_webhook_stripe_verify_fail_total: 'Stripe webhook verify failures',
  gateway_webhook_paypal_ok_total: 'PayPal webhooks verified',
  gateway_webhook_paypal_verify_fail_total: 'PayPal webhook verify failures',
  gateway_webhook_gopay_ok_total: 'GoPay webhooks verified',
  gateway_webhook_gopay_verify_fail_total: 'GoPay webhook verify failures',
  gateway_webhook_cert_seen_total: 'Webhook certificates observed',
  gateway_webhook_replay_total: 'Webhook replay detections',
  gateway_webhook_replay_pruned_total: 'Replay detector keys pruned by expiry/cap',
  gateway_webhook_replay_ttl_ms: 'Configured replay detector TTL (ms)',
  gateway_webhook_replay_max_keys: 'Configured replay detector max key count',
  gateway_webhook_cert_cache_size: 'Cached webhook cert entries',
  gateway_webhook_cert_allow_fail_total: 'Webhook cert URL rejected by allowlist',
  gateway_webhook_cert_pin_fail_total: 'Webhook cert fingerprint failed pin',
  gateway_webhook_stripe_5xx_total: 'Stripe webhook handler 5xx responses',
  gateway_webhook_paypal_5xx_total: 'PayPal webhook handler 5xx responses',
  gateway_webhook_gopay_5xx_total: 'GoPay webhook handler 5xx responses',
  gateway_template_call_total: 'Template API calls received',
  gateway_template_call_ok_total: 'Template API calls forwarded successfully',
  gateway_template_call_blocked_total: 'Template API calls blocked by policy/auth/validation',
  gateway_template_call_backend_fail_total: 'Template API calls failed at backend',
  gateway_integrity_policy_paused: 'Gateway integrity policy paused (1 when paused, 0 otherwise)',
  gateway_integrity_fallback_readonly_total: 'Read-only requests served while integrity policy paused',
  gateway_integrity_unverified_block_total: 'Requests blocked by integrity gate',
  gateway_integrity_verify_ok_total: 'Cache artifact integrity checks passed',
  gateway_integrity_verify_fail_total: 'Cache artifact integrity checks failed',
  gateway_integrity_snapshot_fetch_fail_total: 'AO integrity snapshot fetch/validation failures',
  gateway_integrity_checkpoint_restore_total: 'Integrity state restored from signed local checkpoint',
  gateway_integrity_checkpoint_age_seconds: 'Age of the last integrity checkpoint/snapshot audit in seconds',
  gateway_integrity_audit_seq_from: 'Latest integrity audit sequence start observed by gateway',
  gateway_integrity_audit_seq_to: 'Latest integrity audit sequence end observed by gateway',
  gateway_integrity_audit_lag_seconds: 'Lag in seconds between now and integrity audit acceptance timestamp',
  gateway_integrity_audit_stream_anomaly_total:
    'AO integrity audit stream anomalies detected (sequence regression or invalid ordering)',
  gateway_integrity_incident_total: 'Integrity incidents accepted by gateway',
  gateway_integrity_incident_duplicate_total: 'Integrity incidents detected as duplicate/idempotent replay',
  gateway_integrity_incident_auth_blocked_total: 'Integrity incident requests blocked by auth',
  gateway_integrity_incident_role_blocked_total: 'Integrity incident requests blocked by signature-ref role policy',
  gateway_integrity_state_auth_blocked_total: 'Integrity state requests blocked by auth',
  gateway_integrity_incident_notify_ok_total: 'Integrity incident notifications forwarded successfully',
  gateway_integrity_incident_notify_fail_total: 'Integrity incident notification forwarding failures',
  gateway_integrity_state_read_total: 'Integrity state read requests served',
  gateway_integrity_mirror_mismatch_total:
    'Integrity mirror snapshots that disagree with the primary integrity snapshot',
  gateway_integrity_mirror_fetch_fail_total: 'Integrity mirror snapshot fetch or validation failures',
}

const types: Record<string, 'counter' | 'gauge'> = {}
Object.keys(help).forEach((k) => { types[k] = k.endsWith('_total') ? 'counter' : 'gauge' })

function norm(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_')
}

function noteIntegrityAuditSequenceMetric(name: string, value: number) {
  if (name === 'gateway_integrity_audit_seq_from') {
    auditStreamState.seqFrom = value
    return
  }

  if (name !== 'gateway_integrity_audit_seq_to') {
    return
  }

  const seqFrom = auditStreamState.seqFrom
  const lastSeqTo = auditStreamState.lastSeqTo
  const anomalyDetected =
    (typeof seqFrom === 'number' && value < seqFrom) ||
    (typeof lastSeqTo === 'number' && value < lastSeqTo)

  if (anomalyDetected) {
    inc('gateway_integrity_audit_stream_anomaly')
  }

  auditStreamState.lastSeqTo = value
}

export function inc(name: string, value = 1) {
  const k = norm(name)
  counters[k] = (counters[k] || 0) + value
}

export function gauge(name: string, value: number) {
  const k = norm(name)
  gauges[k] = value
  noteIntegrityAuditSequenceMetric(k, value)
}

export function snapshot() {
  return { counters: { ...counters }, gauges: { ...gauges } }
}

export function toProm(): string {
  const lines: string[] = []
  Object.entries(help).forEach(([k, v]) => {
    if (types[k] === 'counter') lines.push(`# HELP ${k} ${v}`)
    if (types[k] === 'counter') lines.push(`# TYPE ${k} counter`)
    if (types[k] === 'gauge') lines.push(`# HELP ${k} ${v}`)
    if (types[k] === 'gauge') lines.push(`# TYPE ${k} gauge`)
  })
  for (const [k, v] of Object.entries(counters)) {
    lines.push(`${k}_total ${v}`)
  }
  for (const [k, v] of Object.entries(gauges)) {
    lines.push(`${k} ${v}`)
  }
  return lines.join('\n') + '\n'
}

export function reset() {
  Object.keys(counters).forEach((k) => delete counters[k])
  Object.keys(gauges).forEach((k) => delete gauges[k])
  delete auditStreamState.seqFrom
  delete auditStreamState.lastSeqTo
}
