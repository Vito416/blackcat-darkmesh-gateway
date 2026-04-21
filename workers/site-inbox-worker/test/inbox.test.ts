import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const env = {
  INBOX_TTL_DEFAULT: '60',
  INBOX_TTL_MAX: '300',
  FORGET_TOKEN: 'test-token',
  WORKER_READ_TOKEN: 'test-token',
  WORKER_FORGET_TOKEN: 'test-token',
  WORKER_NOTIFY_TOKEN: 'test-token',
  WORKER_SIGN_TOKEN: 'test-token',
  RATE_LIMIT_MAX: '5',
  RATE_LIMIT_WINDOW: '60',
  REPLAY_TTL: '600',
  SUBJECT_MAX_ENVELOPES: '5',
  PAYLOAD_MAX_BYTES: '10240',
  INBOX_HMAC_SECRET: '',
  TEST_IN_MEMORY_KV: 1,
}

async function req(path: string, init: RequestInit = {}) {
  const r = new Request(`http://localhost${path}`, init)
  return mod.fetch(r, env as any, {} as any)
}

function replayLockNamespaceMock() {
  const locks = new Map<string, number>()
  return {
    idFromName(name: string) {
      return name
    },
    get(id: unknown) {
      const replayKey = String(id)
      return {
        async fetch(urlRaw: string, init?: RequestInit) {
          const url = new URL(urlRaw)
          if (url.pathname === '/forget') {
            locks.delete(replayKey)
            return new Response('ok', { status: 200 })
          }
          if (url.pathname !== '/claim') {
            return new Response('not_found', { status: 404 })
          }
          const now = Math.floor(Date.now() / 1000)
          let ttl = 600
          try {
            const raw = typeof init?.body === 'string' ? init.body : '{}'
            const body = JSON.parse(raw) as { ttl?: number }
            if (typeof body.ttl === 'number' && Number.isFinite(body.ttl) && body.ttl > 0) {
              ttl = Math.floor(body.ttl)
            }
          } catch {
            // keep default
          }
          const exp = locks.get(replayKey) || 0
          if (exp > now) {
            return new Response('replay', { status: 409 })
          }
          locks.set(replayKey, now + ttl)
          return new Response('ok', { status: 201 })
        },
      }
    },
  }
}

describe('Inbox flow', () => {
  it('stores and fetches then deletes', async () => {
    const res = await req('/inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'subj', nonce: 'n1', payload: 'cipher' }),
    })
    expect([201, 409]).toContain(res.status)
    const getRes = await req('/inbox/subj/n1', {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect([200, 404]).toContain(getRes.status) // if replay caused overwrite/clean
    if (getRes.status === 200) {
      const body = await getRes.json()
      expect(body.payload).toBe('cipher')
      const notFound = await req('/inbox/subj/n1', {
        headers: { Authorization: 'Bearer test-token' },
      })
      expect(notFound.status).toBe(404)
    }
  })

  it('supports forget', async () => {
    await req('/inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'subj2', nonce: 'n2', payload: 'cipher' }),
    })
    const res = await req('/forget', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ subject: 'subj2' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBeGreaterThanOrEqual(1)
    expect(body.replayDeleted).toBeGreaterThanOrEqual(1)
    const getRes = await req('/inbox/subj2/n2', {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(getRes.status).toBe(404)
  })

  it('enforces replay guard atomically for concurrent same nonce writes', async () => {
    const subject = `subj-race-${Date.now()}`
    const nonce = 'n-race'
    const body = JSON.stringify({ subject, nonce, payload: 'cipher' })
    const raceEnv = { ...env, RATE_LIMIT_MAX: '0' }

    const [a, b] = await Promise.all([
      mod.fetch(
        new Request('http://localhost/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        raceEnv as any,
        {} as any,
      ),
      mod.fetch(
        new Request('http://localhost/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        raceEnv as any,
        {} as any,
      ),
    ])

    const statuses = [a.status, b.status].sort((x, y) => x - y)
    expect(statuses).toEqual([201, 409])
  })

  it('fails closed in strong replay mode when replay lock binding is missing', async () => {
    const strongEnv = { ...env, REPLAY_STRONG_MODE: '1', RATE_LIMIT_MAX: '0' }
    const subject = `subj-strong-${Date.now()}`
    const nonce = `n-${Date.now()}`
    const res = await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, nonce, payload: 'cipher' }),
      }),
      strongEnv as any,
      {} as any,
    )
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_replay_lock_binding')
  })

  it('enforces replay guard via durable-object lock in strong mode', async () => {
    const subject = `subj-do-${Date.now()}`
    const nonce = 'n-race'
    const body = JSON.stringify({ subject, nonce, payload: 'cipher' })
    const raceEnv = {
      ...env,
      RATE_LIMIT_MAX: '0',
      REPLAY_STRONG_MODE: '1',
      REPLAY_LOCKS: replayLockNamespaceMock(),
    }

    const [a, b] = await Promise.all([
      mod.fetch(
        new Request('http://localhost/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        raceEnv as any,
        {} as any,
      ),
      mod.fetch(
        new Request('http://localhost/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        raceEnv as any,
        {} as any,
      ),
    ])

    const statuses = [a.status, b.status].sort((x, y) => x - y)
    expect(statuses).toEqual([201, 409])
  })

  it('clears durable replay lock via /forget', async () => {
    const subject = `subj-do-forget-${Date.now()}`
    const nonce = 'n-forget'
    const body = JSON.stringify({ subject, nonce, payload: 'cipher' })
    const replayLocks = replayLockNamespaceMock()
    const replayEnv = {
      ...env,
      RATE_LIMIT_MAX: '0',
      REPLAY_STRONG_MODE: '1',
      REPLAY_LOCKS: replayLocks,
    }

    const first = await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      replayEnv as any,
      {} as any,
    )
    expect(first.status).toBe(201)

    const blocked = await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      replayEnv as any,
      {} as any,
    )
    expect(blocked.status).toBe(409)

    const forget = await mod.fetch(
      new Request('http://localhost/forget', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ subject }),
      }),
      replayEnv as any,
      {} as any,
    )
    expect(forget.status).toBe(200)

    const afterForget = await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      replayEnv as any,
      {} as any,
    )
    expect(afterForget.status).toBe(201)
  })

  it('rejects malformed forget payload', async () => {
    const res = await req('/forget', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: '{',
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('invalid_json')
  })

  it('enforces scoped read token when strict scopes are enabled', async () => {
    const strictEnv = { ...env, WORKER_STRICT_TOKEN_SCOPES: '1', WORKER_READ_TOKEN: '' }
    const reqObj = new Request('http://localhost/inbox/subj/n1', {
      headers: { Authorization: 'Bearer test-token' },
    })
    const res = await mod.fetch(reqObj, strictEnv as any, {} as any)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_read_token')
  })

  it('rejects strict mode when scoped tokens are not unique', async () => {
    const strictEnv = {
      ...env,
      WORKER_STRICT_TOKEN_SCOPES: '1',
      WORKER_READ_TOKEN: 'same-token',
      WORKER_FORGET_TOKEN: 'same-token',
      WORKER_NOTIFY_TOKEN: 'notify-token',
      WORKER_SIGN_TOKEN: 'sign-token',
    }
    const reqObj = new Request('http://localhost/inbox/subj/n1', {
      headers: { Authorization: 'Bearer same-token' },
    })
    const res = await mod.fetch(reqObj, strictEnv as any, {} as any)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('scoped_tokens_not_unique')
  })
})
