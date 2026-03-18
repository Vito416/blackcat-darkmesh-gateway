import crypto from 'crypto'
import { existsSync } from 'fs'

const buildDir = new URL('../dist/', import.meta.url)

function importBuilt(relPath) {
  const url = new URL(relPath, buildDir)
  if (!existsSync(url)) throw new Error(`missing build output: ${url.pathname} (run "npm run build" first)`)
  return import(url.href)
}

const { toProm, reset } = await importBuilt('metrics.js')
let handleRequest

async function req(path, body, headers = {}) {
  if (!handleRequest) throw new Error('handler not loaded')
  return handleRequest(
    new Request(`http://gateway${path}`, {
      method: 'POST',
      body,
      headers: new Headers(headers),
    }),
  )
}

function stripeSig(secret, ts, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
}
function paypalSig(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function chaosStripe() {
  const secret = 'sec_test'
  const ts = Math.floor(Date.now() / 1000)
  for (let i = 0; i < 20; i++) {
    const body = JSON.stringify({ id: `evt_${i}`, attempt: i })
    const bad = i % 2 === 0
    const sig = stripeSig(bad ? 'wrong' : secret, ts, body)
    const res = await req('/webhook/stripe', body, { 'Stripe-Signature': `t=${ts},v1=${sig}` })
    // bad sig -> 401, good sig -> 200 (replay allowed to return 200)
    assert([200, 401].includes(res.status), `stripe chaos status ${res.status}`)
  }
  // Replay burst with valid signature to ensure no 5xx
  const replayBody = JSON.stringify({ id: 'evt_replay' })
  const replaySig = stripeSig(secret, ts, replayBody)
  for (let j = 0; j < 5; j++) {
    const res = await req('/webhook/stripe', replayBody, { 'Stripe-Signature': `t=${ts},v1=${replaySig}` })
    assert([200].includes(res.status), `stripe replay status ${res.status}`)
  }
}

async function chaosPayPal() {
  const secret = 'sec_test'
  for (let i = 0; i < 10; i++) {
    const body = JSON.stringify({ id: `pp_evt_${i}` })
    const bad = i % 2 === 0
    const sig = paypalSig(bad ? 'wrong' : secret, body)
    const certUrl = bad ? 'https://evil.example/cert.pem' : 'https://trusted.paypal.com/cert.pem'
    const res = await req('/webhook/paypal', body, {
      'PayPal-Transmission-Sig': sig,
      'PayPal-Cert-Url': certUrl,
      'PayPal-Cert-Sha256': bad ? 'deadbeef' : 'good',
      'PayPal-Transmission-Id': `tid-${i}`,
    })
    assert([200, 401].includes(res.status), `paypal chaos status ${res.status}`)
  }
  // Replay burst with valid headers
  const body = '{"id":"pp_replay"}'
  const sig = paypalSig(secret, body)
  for (let j = 0; j < 3; j++) {
    const res = await req('/webhook/paypal', body, {
      'PayPal-Transmission-Sig': sig,
      'PayPal-Cert-Url': 'https://trusted.paypal.com/cert.pem',
      'PayPal-Cert-Sha256': 'good',
      'PayPal-Transmission-Id': 'tid-replay',
    })
    assert([200].includes(res.status), `paypal replay status ${res.status}`)
  }
}

async function main() {
  process.env.STRIPE_WEBHOOK_SECRET = 'sec_test'
  process.env.PAYPAL_WEBHOOK_SECRET = 'sec_test'
  process.env.PAYPAL_CERT_ALLOW_PREFIXES = 'https://trusted.paypal.com/'
  process.env.GW_CERT_PIN_SHA256 = 'deadbeef'
  ;({ handleRequest } = await importBuilt('handler.js'))
  reset()
  await chaosStripe()
  await chaosPayPal()
  const prom = toProm()
  assert(!prom.includes('gateway_webhook_stripe_5xx_total 1'), 'stripe 5xx seen')
  assert(!prom.includes('gateway_webhook_paypal_5xx_total 1'), 'paypal 5xx seen')
  console.log('psp-chaos: ok')
}

main().catch((err) => {
  console.error('psp-chaos failed:', err.message)
  process.exit(1)
})
