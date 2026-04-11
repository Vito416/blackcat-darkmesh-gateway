export type MailValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface NormalizedMailPayload {
  to: string[]
  subject: string
  body: string
}

const EMAIL_LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/
const EMAIL_DOMAIN_LABEL_RE = /^[A-Za-z0-9-]+$/
const EMAIL_CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidationFailure<T>(result: MailValidationResult<T>): result is { ok: false; error: string } {
  return result.ok === false
}

function validateEmailDomain(domain: string): MailValidationResult<string> {
  if (domain.length > 253) return { ok: false, error: 'email domain is too long' }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return { ok: false, error: 'email domain is malformed' }
  }

  const labels = domain.split('.')
  if (labels.length < 2) return { ok: false, error: 'email domain must include a dot' }

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return { ok: false, error: 'email domain label length is invalid' }
    }
    if (!EMAIL_DOMAIN_LABEL_RE.test(label)) {
      return { ok: false, error: 'email domain contains invalid characters' }
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return { ok: false, error: 'email domain labels cannot start or end with a hyphen' }
    }
  }

  return { ok: true, value: domain }
}

function validateEmailLocalPart(local: string): MailValidationResult<string> {
  if (local.length === 0 || local.length > 64) return { ok: false, error: 'email local part length is invalid' }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { ok: false, error: 'email local part is malformed' }
  }
  if (!EMAIL_LOCAL_PART_RE.test(local)) {
    return { ok: false, error: 'email local part contains invalid characters' }
  }
  return { ok: true, value: local }
}

function normalizeRecipients(value: unknown): MailValidationResult<string[]> {
  const rawRecipients = typeof value === 'string' ? [value] : value
  if (!Array.isArray(rawRecipients)) {
    return { ok: false, error: 'payload.to must be a string or non-empty array of email addresses' }
  }
  if (rawRecipients.length === 0) {
    return { ok: false, error: 'payload.to must be a string or non-empty array of email addresses' }
  }

  const recipients: string[] = []
  for (let index = 0; index < rawRecipients.length; index += 1) {
    const recipient = validateEmailAddress(rawRecipients[index])
    if (isValidationFailure(recipient)) {
      return { ok: false, error: `payload.to[${index}] is invalid: ${recipient.error}` }
    }
    recipients.push(recipient.value)
  }

  return { ok: true, value: recipients }
}

export function validateEmailAddress(value: unknown): MailValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'email address must be a string' }

  const normalized = value.trim()
  if (!normalized) return { ok: false, error: 'email address must not be empty' }
  if (normalized.length > 254) return { ok: false, error: 'email address is too long' }
  if (EMAIL_CONTROL_CHARS_RE.test(normalized) || /\s/.test(normalized)) {
    return { ok: false, error: 'email address cannot contain whitespace or control characters' }
  }

  const atIndex = normalized.indexOf('@')
  if (atIndex <= 0 || atIndex !== normalized.lastIndexOf('@') || atIndex === normalized.length - 1) {
    return { ok: false, error: 'email address must contain a single @ separator' }
  }

  const local = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1).toLowerCase()

  const localResult = validateEmailLocalPart(local)
  if (!localResult.ok) return localResult

  const domainResult = validateEmailDomain(domain)
  if (!domainResult.ok) return domainResult

  return { ok: true, value: `${localResult.value}@${domainResult.value}` }
}

export function validateMailPayload(payload: unknown): MailValidationResult<NormalizedMailPayload> {
  if (!isRecord(payload)) return { ok: false, error: 'payload must be an object' }

  const to = normalizeRecipients(payload.to)
  if (isValidationFailure(to)) return { ok: false, error: to.error }

  if (typeof payload.subject !== 'string') return { ok: false, error: 'payload.subject must be a string' }
  if (typeof payload.body !== 'string') return { ok: false, error: 'payload.body must be a string' }

  const subject = payload.subject.trim()
  const body = payload.body.trim()

  if (!subject) return { ok: false, error: 'payload.subject must not be empty' }
  if (!body) return { ok: false, error: 'payload.body must not be empty' }

  return {
    ok: true,
    value: {
      to: to.value,
      subject,
      body,
    },
  }
}
