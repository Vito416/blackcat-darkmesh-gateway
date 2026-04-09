export type CounterMap = Record<string, number>
export type GaugeMap = Record<string, number>

type MetricState = { counters: CounterMap; gauges: GaugeMap }
const globalState: MetricState = (globalThis as any).__gatewayMetrics || { counters: {}, gauges: {} }
;(globalThis as any).__gatewayMetrics = globalState

const counters: CounterMap = globalState.counters
const gauges: GaugeMap = globalState.gauges

const help: Record<string, string> = {
  gateway_cache_hit_total: 'Cache hits',
  gateway_cache_miss_total: 'Cache misses',
  gateway_cache_expired_total: 'Cache entries expired',
  gateway_cache_swept_total: 'Cache entries removed by sweep',
  gateway_cache_size: 'Cache entries currently stored',
  gateway_cache_ttl_ms: 'Configured cache TTL (ms)',
  gateway_inbox_accept_total: 'Inbox requests accepted',
  gateway_ratelimit_blocked_total: 'Requests blocked by rate limit',
  gateway_ratelimit_buckets: 'Active rate-limit buckets',
  gateway_metrics_auth_blocked_total: 'Unauthorized requests to /metrics',
  gateway_webhook_stripe_ok_total: 'Stripe webhooks verified',
  gateway_webhook_stripe_verify_fail_total: 'Stripe webhook verify failures',
  gateway_webhook_paypal_ok_total: 'PayPal webhooks verified',
  gateway_webhook_paypal_verify_fail_total: 'PayPal webhook verify failures',
  gateway_webhook_cert_seen_total: 'Webhook certificates observed',
  gateway_webhook_replay_total: 'Webhook replay detections',
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
}

const types: Record<string, 'counter' | 'gauge'> = {}
Object.keys(help).forEach((k) => { types[k] = k.endsWith('_total') ? 'counter' : 'gauge' })

function norm(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_')
}

export function inc(name: string, value = 1) {
  const k = norm(name)
  counters[k] = (counters[k] || 0) + value
}

export function gauge(name: string, value: number) {
  gauges[norm(name)] = value
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
}
