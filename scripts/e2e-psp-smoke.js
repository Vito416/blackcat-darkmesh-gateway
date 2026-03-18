import crypto from 'crypto'
import { handleRequest } from '../src/handler'
import { toProm } from '../src/metrics'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function req(url, body, headers = {}) {
  return handleRequest(new Request(url, { method: 'POST', body, headers: new Headers(headers) }))
}

async function main() {
  // Stripe missing signature
  process.env.STRIPE_WEBHOOK_SECRET = 'sec_test'
  let res = await req('http://gateway/webhook/stripe', '{}')
  assert(res.status === 401, `stripe missing sig expected 401 got ${res.status}`)

  // Stripe old timestamp (replay window)
  const tsOld = Math.floor(Date.now() / 1000) - 120
  const body = '{"id":"evt_old"}'
  const sigOld = crypto.createHmac('sha256', 'sec_test').update(`${tsOld}.${body}`).digest('hex')
  res = await req('http://gateway/webhook/stripe', body, { 'Stripe-Signature': `t=${tsOld},v1=${sigOld}` })
  assert(res.status === 401, `stripe old ts expected 401 got ${res.status}`)

  // PayPal pin fail
  process.env.PAYPAL_WEBHOOK_SECRET = 'sec_test'
  process.env.GW_CERT_PIN_SHA256 = 'deadbeef'
  res = await req('http://gateway/webhook/paypal', '{}', { 'PayPal-Transmission-Sig': 'bad' })
  assert(res.status === 401, `paypal pin fail expected 401 got ${res.status}`)

  // Metrics sanity
  const prom = toProm()
  assert(prom.includes('gateway_webhook_stripe_verify_fail_total'), 'missing stripe metric')
  console.log('psp-smoke: ok')
}

main().catch((err) => {
  console.error('psp-smoke failed:', err.message)
  process.exit(1)
})
