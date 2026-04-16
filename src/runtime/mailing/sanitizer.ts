export type MailSanitizeResult = { ok: true; value: string } | { ok: false; error: string }

const SUBJECT_CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g
const BODY_CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g

export function sanitizeMailSubject(value: unknown): MailSanitizeResult {
  if (typeof value !== 'string') return { ok: false, error: 'subject must be a string' }

  const sanitized = value.replace(SUBJECT_CONTROL_CHARS_RE, '').trim()
  if (!sanitized) return { ok: false, error: 'subject is empty after sanitization' }

  return { ok: true, value: sanitized }
}

export function sanitizeMailBody(value: unknown): MailSanitizeResult {
  if (typeof value !== 'string') return { ok: false, error: 'body must be a string' }

  const sanitized = value.replace(BODY_CONTROL_CHARS_RE, '')
  if (sanitized.trim().length === 0) return { ok: false, error: 'body is empty after sanitization' }

  return { ok: true, value: sanitized }
}
