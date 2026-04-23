import http from 'k6/http'
import crypto from 'k6/crypto'
import { check, sleep } from 'k6'

// Env
const BASE = __ENV.WORKER_BASE_URL || 'http://127.0.0.1:8787'
const INBOX_HMAC_SECRET = __ENV.INBOX_HMAC_SECRET || 'ci-inbox'
const NOTIFY_HMAC_SECRET = __ENV.NOTIFY_HMAC_SECRET || 'ci-notify'
const FORGET_TOKEN = __ENV.WORKER_AUTH_TOKEN || __ENV.FORGET_TOKEN || 'ci-token'
const FAILING_WEBHOOK_URL = __ENV.FAILING_WEBHOOK_URL || ''

export const options = {
  scenarios: {
    inbox: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
    notify: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 5,
      maxVUs: 15,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'], // tolerate up to 5% errors (breaker/429 acceptable)
  },
}

function hmac(secret, body) {
  return crypto.hmac('sha256', body, secret, 'hex')
}

export function inbox() {
  const nonce = `n-${__VU}-${Date.now()}-${Math.random()}`
  const subj = `stress-${__VU}`
  const payload = JSON.stringify({ subject: subj, nonce, payload: 'x' })
  const sig = hmac(INBOX_HMAC_SECRET, payload)
  const res = http.post(`${BASE}/inbox`, payload, {
    headers: { 'content-type': 'application/json', 'x-signature': sig },
  })
  check(res, { 'inbox status ok': (r) => [200, 201, 409, 429].includes(r.status) })
  sleep(0.1)
}

export function notify() {
  const body = JSON.stringify({
    webhookUrl: FAILING_WEBHOOK_URL || 'https://example.com/ok',
    data: { ts: Date.now(), vu: __VU },
  })
  const sig = hmac(NOTIFY_HMAC_SECRET, body)
  const res = http.post(`${BASE}/notify`, body, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${FORGET_TOKEN}`,
      'x-signature': sig,
    },
  })
  // Notify may return 200/202 (ok), 502 (breaker), 429 (rate/breaker), tolerate them
  check(res, { 'notify acceptable': (r) => [200, 202, 502, 429].includes(r.status) })
  sleep(0.2)
}
