export type CounterMap = Record<string, number>
export type GaugeMap = Record<string, number>

const counters: CounterMap = {}
const gauges: GaugeMap = {}

const help: Record<string, string> = {
  gateway_cache_hit_total: 'Cache hits',
  gateway_cache_miss_total: 'Cache misses',
  gateway_cache_expired_total: 'Cache entries expired',
  gateway_cache_swept_total: 'Cache entries removed by sweep',
  gateway_cache_size: 'Cache entries currently stored',
  gateway_inbox_accept_total: 'Inbox requests accepted',
  gateway_ratelimit_blocked_total: 'Requests blocked by rate limit',
  gateway_ratelimit_buckets: 'Active rate-limit buckets',
  gateway_webhook_stripe_ok_total: 'Stripe webhooks verified',
  gateway_webhook_stripe_verify_fail_total: 'Stripe webhook verify failures',
  gateway_webhook_paypal_ok_total: 'PayPal webhooks verified',
  gateway_webhook_paypal_verify_fail_total: 'PayPal webhook verify failures',
  gateway_webhook_cert_seen_total: 'Webhook certificates observed',
  gateway_webhook_replay_total: 'Webhook replay detections',
  gateway_webhook_cert_cache_size: 'Cached webhook cert entries',
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
