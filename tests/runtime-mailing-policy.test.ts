import { describe, expect, it } from 'vitest'
import { validateEmailAddress, validateMailPayload } from '../src/runtime/mailing/payloadPolicy.js'
import { sanitizeMailBody, sanitizeMailSubject } from '../src/runtime/mailing/sanitizer.js'

describe('runtime mailing payload policy helpers', () => {
  it('validates and normalizes email addresses', () => {
    expect(validateEmailAddress(' User.Name+tag@Example.COM ')).toEqual({
      ok: true,
      value: 'User.Name+tag@example.com',
    })
  })

  it('rejects malformed email addresses', () => {
    const invalid = [
      undefined,
      '',
      'no-at-sign',
      'too@@many@example.com',
      'a@b',
      'foo..bar@example.com',
      'foo@-example.com',
      'foo@example..com',
      'foo@exa mple.com',
      'foo@\u0000example.com',
    ]

    for (const candidate of invalid) {
      const result = validateEmailAddress(candidate)
      expect(result.ok).toBe(false)
    }
  })

  it('normalizes payloads with string and array recipients into a deterministic shape', () => {
    expect(validateMailPayload({ to: 'Alice@Example.COM', subject: ' Hello ', body: ' World ' })).toEqual({
      ok: true,
      value: {
        to: ['Alice@example.com'],
        subject: 'Hello',
        body: 'World',
      },
    })

    expect(
      validateMailPayload({
        to: ['bob@example.com', 'CAROL@Example.COM'],
        subject: 'Subject',
        body: 'Body',
      }),
    ).toEqual({
      ok: true,
      value: {
        to: ['bob@example.com', 'CAROL@example.com'],
        subject: 'Subject',
        body: 'Body',
      },
    })
  })

  it('rejects malformed payloads', () => {
    expect(validateMailPayload(null)).toEqual({ ok: false, error: 'payload must be an object' })
    expect(validateMailPayload({ subject: 's', body: 'b' })).toEqual({
      ok: false,
      error: 'payload.to must be a string or non-empty array of email addresses',
    })
    expect(validateMailPayload({ to: [], subject: 's', body: 'b' })).toEqual({
      ok: false,
      error: 'payload.to must be a string or non-empty array of email addresses',
    })
    expect(validateMailPayload({ to: ['ok@example.com', 'bad'], subject: 's', body: 'b' })).toEqual({
      ok: false,
      error: 'payload.to[1] is invalid: email address must contain a single @ separator',
    })
    expect(validateMailPayload({ to: 'ok@example.com', subject: ' ', body: 'b' })).toEqual({
      ok: false,
      error: 'payload.subject must not be empty',
    })
    expect(validateMailPayload({ to: 'ok@example.com', subject: 's', body: '\n\t ' })).toEqual({
      ok: false,
      error: 'payload.body must not be empty',
    })
  })
})

describe('runtime mailing sanitizer helpers', () => {
  it('strips control characters from subject and fails closed on empty output', () => {
    expect(sanitizeMailSubject('  Hello\u0000\u0007\r\nWorld\t ')).toEqual({
      ok: true,
      value: 'HelloWorld',
    })

    expect(sanitizeMailSubject('\u0000\t\r\n')).toEqual({
      ok: false,
      error: 'subject is empty after sanitization',
    })
  })

  it('strips body control characters while preserving tabs and newlines', () => {
    expect(sanitizeMailBody('Hello\u0000\tWorld\nLine2\r\u0007!')).toEqual({
      ok: true,
      value: 'Hello\tWorld\nLine2!',
    })
  })

  it('fails closed when body output is empty after sanitization', () => {
    expect(sanitizeMailBody('\u0000\u0007\r')).toEqual({
      ok: false,
      error: 'body is empty after sanitization',
    })
  })
})
