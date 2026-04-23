import http from 'k6/http'
import crypto from 'k6/crypto'
import { check, sleep } from 'k6'

const BASE = __ENV.WORKER_BASE_URL || 'http://localhost:8787'
const INBOX_HMAC_SECRET = __ENV.INBOX_HMAC_SECRET || ''
const NOTIFY_HMAC_SECRET = __ENV.NOTIFY_HMAC_SECRET || ''
const WORKER_AUTH_TOKEN = __ENV.WORKER_AUTH_TOKEN || ''
const LITE = __ENV.LITE_MODE || '1'

export const options = {
  scenarios: {
    bad_sig: { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '20s', preAllocatedVUs: 5, exec: 'badSig' },
    replay: { executor: 'constant-arrival-rate', rate: 3, timeUnit: '1s', duration: '20s', preAllocatedVUs: 3, exec: 'replay' },
    notify_fail: { executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '20s', preAllocatedVUs: 2, exec: 'notifyFail' },
  },
  thresholds: {
    // Treat auth/replay blocks as expected; focus on unexpected 5xx
    'http_req_failed{status:5xx}': ['rate<0.01'],
  },
}

function hmac(secret, body) {
  if (!secret) return ''
  return crypto.hmac('sha256', body, secret, 'hex')
}

export function badSig() {
  const body = JSON.stringify({ subject: 'chaos', nonce: `n-${__ITER}`, payload: 'x' })
  const res = http.post(`${BASE}/inbox`, body, { headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' } })
  check(res, { '401/403 expected': (r) => [401, 403].includes(r.status) })
  sleep(0.1)
}

export function replay() {
  const nonce = 'fixed-nonce'
  const body = JSON.stringify({ subject: 'chaos', nonce, payload: 'x' })
  const sig = hmac(INBOX_HMAC_SECRET, body)
  const res = http.post(`${BASE}/inbox`, body, { headers: { 'content-type': 'application/json', 'x-signature': sig } })
  check(res, { 'first ok or 409/429': (r) => [200, 201, 409, 429].includes(r.status) })
  sleep(0.2)
}

export function notifyFail() {
  const body = JSON.stringify({ webhookUrl: 'https://httpbin.org/status/500', data: { msg: 'fail' } })
  const sig = hmac(NOTIFY_HMAC_SECRET, body)
  const res = http.post(`${BASE}/notify`, body, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${WORKER_AUTH_TOKEN}`,
      'x-signature': sig,
      'x-lite-mode': LITE,
    },
  })
  check(res, { '502/429/202 acceptable': (r) => [202, 429, 502].includes(r.status) })
  sleep(0.3)
}
