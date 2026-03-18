import crypto from 'crypto'
import { existsSync } from 'fs'

const buildDir = new URL('../dist/', import.meta.url)

function importBuilt(relPath) {
  const url = new URL(relPath, buildDir)
  if (!existsSync(url)) {
    throw new Error(`missing build output: ${url.pathname} (run \"npm run build\" first)`)
  }
  return import(url.href)
}

const { toProm } = await importBuilt('metrics.js')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

let handleRequest

async function req(url, body, headers = {}) {
  if (!handleRequest) throw new Error('handler not loaded')
  return handleRequest(new Request(url, { method: 'POST', body, headers: new Headers(headers) }))
}

function stripeSignature(secret, ts, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
}

function paypalSignature(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function main() {
  // Configure env before importing handler (webhook cert allowlist/pin is captured at load time)
  process.env.STRIPE_WEBHOOK_SECRET = 'sec_test'
  process.env.PAYPAL_WEBHOOK_SECRET = 'sec_test'
  process.env.PAYPAL_CERT_ALLOW_PREFIXES = 'https://trusted.paypal.com/'
  process.env.GW_CERT_PIN_SHA256 = 'deadbeef'
  ;({ handleRequest } = await importBuilt('handler.js'))

  // Stripe missing signature
  let res = await req('http://gateway/webhook/stripe', '{}')
  assert(res.status === 401, `stripe missing sig expected 401 got ${res.status}`)

  // Stripe old timestamp (replay window)
  const tsOld = Math.floor(Date.now() / 1000) - 600 // older than default tolerance (5m)
  const body = '{"id":"evt_old"}'
  const sigOld = stripeSignature('sec_test', tsOld, body)
  res = await req('http://gateway/webhook/stripe', body, { 'Stripe-Signature': `t=${tsOld},v1=${sigOld}` })
  assert(res.status === 401, `stripe old ts expected 401 got ${res.status}`)

  // Stripe bad signature
  const tsNow = Math.floor(Date.now() / 1000)
  const bodyBad = '{"id":"evt_bad_sig"}'
  const sigBad = stripeSignature('wrong_secret', tsNow, bodyBad)
  res = await req('http://gateway/webhook/stripe', bodyBad, { 'Stripe-Signature': `t=${tsNow},v1=${sigBad}` })
  assert(res.status === 401, `stripe bad sig expected 401 got ${res.status}`)

  // PayPal pin fail
  res = await req('http://gateway/webhook/paypal', '{}', { 'PayPal-Transmission-Sig': 'bad', 'PayPal-Cert-Url': 'https://trusted.paypal.com/cert.pem' })
  assert(res.status === 401, `paypal pin fail expected 401 got ${res.status}`)

  // PayPal allowlist fail (evil cert URL)
  const paypalBody = '{"id":"evt_evil_cert"}'
  const paypalSig = paypalSignature('sec_test', paypalBody)
  res = await req('http://gateway/webhook/paypal', paypalBody, {
    'PayPal-Transmission-Sig': paypalSig,
    'PayPal-Cert-Url': 'https://evil.example/cert.pem',
    'PayPal-Cert-Sha256': 'deadbeef',
  })
  assert(res.status === 401, `paypal allowlist fail expected 401 got ${res.status}`)

  // Metrics sanity
  const prom = toProm()
  assert(prom.includes('gateway_webhook_stripe_verify_fail_total'), 'missing stripe metric')
  console.log('psp-smoke: ok')
}

main().catch((err) => {
  console.error('psp-smoke failed:', err.message)
  process.exit(1)
})
