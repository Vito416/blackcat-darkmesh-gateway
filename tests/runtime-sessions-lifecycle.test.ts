import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInMemorySessionLifecycleStore,
  createSessionLifecycleService,
} from '../src/runtime/sessions/lifecycle.js'

describe('runtime sessions lifecycle boundary', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates, reads, rotates, and revokes sessions deterministically', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)

    const ids = ['session-1', 'session-2']
    const service = createSessionLifecycleService(createInMemorySessionLifecycleStore(), {
      now: () => Date.now(),
      idFactory: () => ids.shift() || 'fallback-id',
      defaultTtlMs: 1_000,
    })

    const created = service.create({
      subject: 'user-123',
      claims: { scope: 'read' },
      context: { ip: '127.0.0.1' },
    })

    expect(created).toEqual({
      ok: true,
      session: {
        id: 'session-1',
        subject: 'user-123',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_001_000,
        ttlMs: 1_000,
        status: 'active',
        claims: { scope: 'read' },
        context: { ip: '127.0.0.1' },
      },
    })

    expect(service.read('session-1')).toEqual({
      ok: true,
      session: {
        id: 'session-1',
        subject: 'user-123',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_001_000,
        ttlMs: 1_000,
        status: 'active',
        claims: { scope: 'read' },
        context: { ip: '127.0.0.1' },
      },
    })

    const rotated = service.rotate('session-1')
    expect(rotated).toEqual({
      ok: true,
      session: {
        id: 'session-2',
        subject: 'user-123',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_001_000,
        ttlMs: 1_000,
        status: 'active',
        claims: { scope: 'read' },
        context: { ip: '127.0.0.1' },
        rotatedFrom: 'session-1',
      },
      details: {
        previousSessionId: 'session-1',
      },
    })

    expect(service.read('session-1')).toEqual({
      ok: false,
      code: 'session_rotated',
      message: 'session has been rotated',
    })

    expect(service.read('session-2')).toEqual({
      ok: true,
      session: {
        id: 'session-2',
        subject: 'user-123',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_001_000,
        ttlMs: 1_000,
        status: 'active',
        claims: { scope: 'read' },
        context: { ip: '127.0.0.1' },
        rotatedFrom: 'session-1',
      },
    })

    const revoked = service.revoke('session-2')
    expect(revoked).toEqual({
      ok: true,
      session: {
        id: 'session-2',
        subject: 'user-123',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_001_000,
        ttlMs: 1_000,
        status: 'revoked',
        claims: { scope: 'read' },
        context: { ip: '127.0.0.1' },
        rotatedFrom: 'session-1',
        revokedAt: 1_700_000_000_000,
      },
      details: {
        previousStatus: 'active',
      },
    })

    expect(service.read('session-2')).toEqual({
      ok: false,
      code: 'session_revoked',
      message: 'session has been revoked',
    })
  })

  it('rejects invalid inputs and transitions with stable codes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000_000_000)

    const service = createSessionLifecycleService(createInMemorySessionLifecycleStore(), {
      now: () => Date.now(),
      idFactory: () => 'session-a',
      defaultTtlMs: 100,
    })

    expect(service.create({ subject: '   ' })).toEqual({
      ok: false,
      code: 'session_invalid_subject',
      message: 'session subject is required',
    })

    expect(service.read('')).toEqual({
      ok: false,
      code: 'session_invalid_id',
      message: 'session id is required',
    })

    expect(service.rotate('missing')).toEqual({
      ok: false,
      code: 'session_not_found',
      message: 'session was not found',
    })

    const created = service.create({ subject: 'user-1' })
    expect(created.ok).toBe(true)

    vi.advanceTimersByTime(101)

    expect(service.read('session-a')).toEqual({
      ok: false,
      code: 'session_expired',
      message: 'session has expired',
    })
    expect(service.rotate('session-a')).toEqual({
      ok: false,
      code: 'session_expired',
      message: 'session has expired',
    })
    expect(service.revoke('session-a')).toEqual({
      ok: false,
      code: 'session_expired',
      message: 'session has expired',
    })

    const freshService = createSessionLifecycleService(createInMemorySessionLifecycleStore(), {
      now: () => Date.now(),
      idFactory: () => 'session-b',
      defaultTtlMs: 1_000,
    })
    const active = freshService.create({ subject: 'user-2' })
    expect(active.ok).toBe(true)

    expect(freshService.revoke('session-b')).toEqual({
      ok: true,
      session: {
        id: 'session-b',
        subject: 'user-2',
        createdAt: 2_000_000_000_101,
        expiresAt: 2_000_000_001_101,
        ttlMs: 1_000,
        status: 'revoked',
        claims: {},
        context: {},
        revokedAt: 2_000_000_000_101,
      },
      details: {
        previousStatus: 'active',
      },
    })

    expect(freshService.revoke('session-b')).toEqual({
      ok: false,
      code: 'session_revoked',
      message: 'session has already been revoked',
    })
    expect(freshService.rotate('session-b')).toEqual({
      ok: false,
      code: 'session_revoked',
      message: 'session has been revoked',
    })
  })
})
