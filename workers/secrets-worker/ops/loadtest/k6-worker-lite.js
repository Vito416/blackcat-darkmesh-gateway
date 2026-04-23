import http from 'k6/http'
import crypto from 'k6/crypto'
import { check, sleep } from 'k6'

// Lite profile tuned for Cloudflare free limits
// Provide your own target URL via WORKER_BASE_URL; default keeps traffic local/miniflare.
const BASE = __ENV.WORKER_BASE_URL || 'http://localhost:8787'
const INBOX_HMAC_SECRET = __ENV.INBOX_HMAC_SECRET || ''
const NOTIFY_HMAC_SECRET = __ENV.NOTIFY_HMAC_SECRET || ''
const WORKER_NOTIFY_TOKEN = __ENV.WORKER_NOTIFY_TOKEN || __ENV.WORKER_AUTH_TOKEN || ''
const LITE = __ENV.LITE_MODE || '1' // default to lite

export const options = {
  scenarios: {
    inbox: {
      executor: 'constant-arrival-rate',
      rate: 10, // req/s
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'inbox',
    },
    notify: {
      executor: 'constant-arrival-rate',
      rate: 5, // req/s
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 3,
      maxVUs: 10,
      exec: 'notify',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'], // tolerate up to 5% failures (429/502 acceptable)
  },
}

// k6 crypto.hmac uses a different key handling than Node; implement HMAC-SHA256 manually
function hmac(secret, body) {
  if (!secret) return ''
  const toBytes = (str) => {
    const out = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i)
    return out
  }
  const concat = (a, b) => {
    const out = new Uint8Array(a.length + b.length)
    out.set(a, 0)
    out.set(b, a.length)
    return out
  }
  const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

  let key = toBytes(secret)
  if (key.length > 64) {
    key = new Uint8Array(crypto.sha256(key, 'binary'))
  }
  if (key.length < 64) {
    const padded = new Uint8Array(64)
    padded.set(key)
    key = padded
  }

  const oKeyPad = key.map((b) => b ^ 0x5c)
  const iKeyPad = key.map((b) => b ^ 0x36)
  const msgBytes = toBytes(body)

  const inner = new Uint8Array(crypto.sha256(concat(iKeyPad, msgBytes), 'binary'))
  const outer = new Uint8Array(crypto.sha256(concat(oKeyPad, inner), 'binary'))
  return toHex(outer)
}

export function inbox() {
  const nonce = `lite-${__VU}-${Date.now()}-${Math.random()}`
  const subj = 'k6-lite'
  const payload = JSON.stringify({ subject: subj, nonce, payload: 'x' })
  const sig = hmac(INBOX_HMAC_SECRET, payload)
  const res = http.post(`${BASE}/inbox`, payload, {
    headers: { 'content-type': 'application/json', 'x-signature': sig },
  })
  check(res, { 'inbox ok/replay/ratelimit': (r) => [200, 201, 409, 429].includes(r.status) })
  sleep(0.1)
}

export function notify() {
  const body = JSON.stringify({
    webhookUrl: 'https://httpbin.org/status/200',
    data: { msg: 'lite' },
  })
  const sig = hmac(NOTIFY_HMAC_SECRET, body)
  const res = http.post(`${BASE}/notify`, body, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${WORKER_NOTIFY_TOKEN}`,
      'x-signature': sig,
      'x-lite-mode': LITE,
    },
  })
  check(res, { 'notify ok/allowed errors': (r) => [200, 202, 429, 502].includes(r.status) })
  sleep(0.2)
}
