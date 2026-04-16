export type SessionLifecycleStatus = 'active' | 'revoked' | 'rotated'

export type SessionLifecycleSession = {
  id: string
  subject: string
  createdAt: number
  expiresAt: number
  ttlMs: number
  status: SessionLifecycleStatus
  claims: Record<string, unknown>
  context: Record<string, unknown>
  revokedAt?: number
  rotatedAt?: number
  rotatedFrom?: string
  rotatedTo?: string
}

export type SessionLifecycleStore = {
  get(sessionId: string): SessionLifecycleSession | undefined
  set(session: SessionLifecycleSession): void
  delete(sessionId: string): void
  listBySubject(subject: string): SessionLifecycleSession[]
}

export type SessionLifecycleErrorCode =
  | 'session_invalid_id'
  | 'session_invalid_subject'
  | 'session_invalid_ttl'
  | 'session_not_found'
  | 'session_expired'
  | 'session_revoked'
  | 'session_rotated'

export type SessionLifecycleFailure = {
  ok: false
  code: SessionLifecycleErrorCode
  message: string
}

export type SessionLifecycleSuccess<T> = {
  ok: true
  session: SessionLifecycleSession
  details?: T
}

export type SessionLifecycleCreateInput = {
  subject: string
  ttlMs?: number
  claims?: Record<string, unknown>
  context?: Record<string, unknown>
}

export type SessionLifecycleCreateResult = SessionLifecycleSuccess<null> | SessionLifecycleFailure
export type SessionLifecycleReadResult = SessionLifecycleSuccess<null> | SessionLifecycleFailure
export type SessionLifecycleRotateResult = SessionLifecycleSuccess<{ previousSessionId: string }> | SessionLifecycleFailure
export type SessionLifecycleRevokeResult = SessionLifecycleSuccess<{ previousStatus: SessionLifecycleStatus }> | SessionLifecycleFailure

export type SessionLifecycleServiceOptions = {
  now?: () => number
  idFactory?: () => string
  defaultTtlMs?: number
}

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? { ...value } : {}
}

function cloneSession(session: SessionLifecycleSession): SessionLifecycleSession {
  return {
    ...session,
    claims: cloneRecord(session.claims),
    context: cloneRecord(session.context),
  }
}

function normalizeSubject(subject: string): string {
  return typeof subject === 'string' ? subject.trim() : ''
}

function normalizeTtlMs(ttlMs: number | undefined, fallback: number): number | null {
  const raw = ttlMs ?? fallback
  if (!Number.isFinite(raw) || raw <= 0) return null
  const normalized = Math.floor(raw)
  return normalized > 0 ? normalized : null
}

function makeFailure(code: SessionLifecycleErrorCode, message: string): SessionLifecycleFailure {
  return { ok: false, code, message }
}

function makeSuccess<T>(session: SessionLifecycleSession, details?: T): SessionLifecycleSuccess<T> {
  return {
    ok: true,
    session: cloneSession(session),
    ...(details === undefined ? {} : { details }),
  }
}

function isActive(session: SessionLifecycleSession, now: number): boolean {
  return session.status === 'active' && session.expiresAt > now
}

export class InMemorySessionLifecycleStore implements SessionLifecycleStore {
  private readonly sessions = new Map<string, SessionLifecycleSession>()

  constructor(initialSessions: SessionLifecycleSession[] = []) {
    for (const session of initialSessions) {
      this.set(session)
    }
  }

  get(sessionId: string): SessionLifecycleSession | undefined {
    const session = this.sessions.get(sessionId)
    return session ? cloneSession(session) : undefined
  }

  set(session: SessionLifecycleSession): void {
    this.sessions.set(session.id, cloneSession(session))
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  listBySubject(subject: string): SessionLifecycleSession[] {
    const needle = normalizeSubject(subject)
    if (!needle) return []
    const out: SessionLifecycleSession[] = []
    for (const session of this.sessions.values()) {
      if (session.subject === needle) {
        out.push(cloneSession(session))
      }
    }
    return out
  }
}

export function createInMemorySessionLifecycleStore(initialSessions: SessionLifecycleSession[] = []): InMemorySessionLifecycleStore {
  return new InMemorySessionLifecycleStore(initialSessions)
}

export function createSessionLifecycleService(
  store: SessionLifecycleStore,
  options: SessionLifecycleServiceOptions = {},
) {
  const nowFn = options.now || Date.now
  const idFactory = options.idFactory || (() => cryptoRandomId())
  const defaultTtlMs = normalizeTtlMs(options.defaultTtlMs, DEFAULT_TTL_MS) ?? DEFAULT_TTL_MS

  function readSession(sessionId: string): SessionLifecycleReadResult {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) {
      return makeFailure('session_invalid_id', 'session id is required')
    }

    const session = store.get(id)
    if (!session) {
      return makeFailure('session_not_found', 'session was not found')
    }

    const now = nowFn()
    if (session.status === 'revoked') {
      return makeFailure('session_revoked', 'session has been revoked')
    }
    if (session.status === 'rotated') {
      return makeFailure('session_rotated', 'session has been rotated')
    }
    if (session.expiresAt <= now) {
      return makeFailure('session_expired', 'session has expired')
    }

    return makeSuccess(session)
  }

  function createSession(input: SessionLifecycleCreateInput): SessionLifecycleCreateResult {
    const subject = normalizeSubject(input.subject)
    if (!subject) {
      return makeFailure('session_invalid_subject', 'session subject is required')
    }

    const ttlMs = normalizeTtlMs(input.ttlMs, defaultTtlMs)
    if (ttlMs === null) {
      return makeFailure('session_invalid_ttl', 'session ttl must be a positive integer')
    }

    const createdAt = nowFn()
    const session: SessionLifecycleSession = {
      id: idFactory(),
      subject,
      createdAt,
      expiresAt: createdAt + ttlMs,
      ttlMs,
      status: 'active',
      claims: isPlainObject(input.claims) ? cloneRecord(input.claims) : {},
      context: isPlainObject(input.context) ? cloneRecord(input.context) : {},
    }

    store.set(session)
    return makeSuccess(session)
  }

  function rotateSession(sessionId: string): SessionLifecycleRotateResult {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) {
      return makeFailure('session_invalid_id', 'session id is required')
    }

    const current = store.get(id)
    if (!current) {
      return makeFailure('session_not_found', 'session was not found')
    }

    const now = nowFn()
    if (current.status === 'revoked') {
      return makeFailure('session_revoked', 'session has been revoked')
    }
    if (current.status === 'rotated') {
      return makeFailure('session_rotated', 'session has already been rotated')
    }
    if (current.expiresAt <= now) {
      return makeFailure('session_expired', 'session has expired')
    }

    const successor: SessionLifecycleSession = {
      id: idFactory(),
      subject: current.subject,
      createdAt: now,
      expiresAt: now + current.ttlMs,
      ttlMs: current.ttlMs,
      status: 'active',
      claims: cloneRecord(current.claims),
      context: cloneRecord(current.context),
      rotatedFrom: current.id,
    }

    const rotated: SessionLifecycleSession = {
      ...current,
      status: 'rotated',
      rotatedAt: now,
      rotatedTo: successor.id,
    }

    store.set(rotated)
    store.set(successor)

    return makeSuccess(successor, { previousSessionId: rotated.id })
  }

  function revokeSession(sessionId: string): SessionLifecycleRevokeResult {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) {
      return makeFailure('session_invalid_id', 'session id is required')
    }

    const current = store.get(id)
    if (!current) {
      return makeFailure('session_not_found', 'session was not found')
    }

    const now = nowFn()
    if (current.status === 'revoked') {
      return makeFailure('session_revoked', 'session has already been revoked')
    }
    if (current.status === 'rotated') {
      return makeFailure('session_rotated', 'session has already been rotated')
    }
    if (current.expiresAt <= now) {
      return makeFailure('session_expired', 'session has expired')
    }

    const revoked: SessionLifecycleSession = {
      ...current,
      status: 'revoked',
      revokedAt: now,
    }

    store.set(revoked)
    return makeSuccess(revoked, { previousStatus: current.status })
  }

  function listBySubject(subject: string): SessionLifecycleReadResult[] {
    return store.listBySubject(subject).map((session) => makeSuccess(session))
  }

  return {
    create: createSession,
    read: readSession,
    rotate: rotateSession,
    revoke: revokeSession,
    listBySubject,
  }
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
