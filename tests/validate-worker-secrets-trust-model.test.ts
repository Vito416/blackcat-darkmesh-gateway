import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { inspectTrustModel, runCli } from '../scripts/validate-worker-secrets-trust-model.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'worker-secrets-trust-model-validate-'))
  tempDirs.push(dir)
  const file = join(dir, 'worker-secrets-trust-model.md')
  writeFileSync(file, text, 'utf8')
  return file
}

function completeDoc() {
  return [
    '# Worker Secrets Trust Model',
    '',
    '## Invariant',
    '',
    '- Templates are public and verifiable.',
    '- Secrets live only in the per-site worker.',
    '- Gateway request handlers must reject attempts to smuggle worker-secret fields.',
    '- Mailing is a public request-path boundary.',
    '',
    '## Allowed data flow',
    '',
    '- Browser -> Gateway -> public template bundle.',
    '',
    '## Forbidden data flow',
    '',
    '- Templates reading worker secrets directly.',
    '',
    '## Boundary checks',
    '',
    '- Gateway request handlers must reject hidden secret fields.',
    '',
    '## Operational rules',
    '',
    '- For mailing, keep secrets in the worker.',
    '',
    '## Optional notes',
    '',
    '- This section is present so the document is complete.',
    '',
  ].join('\n')
}

function missingHeadingDoc() {
  return [
    '# Worker Secrets Trust Model',
    '',
    '## Invariant',
    '',
    '- Templates are public and verifiable.',
    '- Secrets live only in the per-site worker.',
    '- Gateway request handlers must reject attempts to smuggle worker-secret fields.',
    '- Mailing is a public request-path boundary.',
    '',
    '## Allowed data flow',
    '',
    '- Browser -> Gateway -> public template bundle.',
    '',
    '## Forbidden data flow',
    '',
    '- Templates reading worker secrets directly.',
    '',
    '## Operational rules',
    '',
    '- For mailing, keep secrets in the worker.',
    '',
    '## Optional notes',
    '',
    '- This section is present so the document is complete.',
    '',
  ].join('\n')
}

function missingPhraseDoc() {
  return [
    '# Worker Secrets Trust Model',
    '',
    '## Invariant',
    '',
    '- Templates are public and verifiable.',
    '- Secrets live only in the per-site worker.',
    '- Gateway request handlers must reject attempts to smuggle worker-secret fields.',
    '',
    '## Allowed data flow',
    '',
    '- Browser -> Gateway -> public template bundle.',
    '',
    '## Forbidden data flow',
    '',
    '- Templates reading worker secrets directly.',
    '',
    '## Boundary checks',
    '',
    '- Gateway request handlers must reject hidden secret fields.',
    '',
    '## Operational rules',
    '',
    '- Keep secrets in the worker.',
    '',
    '## Optional notes',
    '',
    '- This section is present so the document is complete.',
    '',
  ].join('\n')
}

function pendingDoc() {
  return [
    '# Worker Secrets Trust Model',
    '',
    '## Invariant',
    '',
    '- Templates are public and verifiable.',
    '- Secrets live only in the per-site worker.',
    '- Gateway request handlers must reject attempts to smuggle worker-secret fields.',
    '- Mailing is a public request-path boundary.',
    '',
    '## Allowed data flow',
    '',
    '- Browser -> Gateway -> public template bundle.',
    '',
    '## Forbidden data flow',
    '',
    '- Templates reading worker secrets directly.',
    '',
    '## Boundary checks',
    '',
    '- Gateway request handlers must reject hidden secret fields.',
    '',
    '## Operational rules',
    '',
    '- For mailing, keep secrets in the worker.',
    '',
  ].join('\n')
}

describe('validate-worker-secrets-trust-model.js', () => {
  it('accepts a complete trust model document in strict mode', () => {
    const file = makeTempFile(completeDoc())

    const result = runCli(['--file', file, '--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('complete')
    expect(parsed.missingHeadings).toEqual([])
    expect(parsed.missingPhrases).toEqual([])
    expect(parsed.warnings).toEqual([])
    expect(parsed.optionalNotesPresent).toBe(true)
  })

  it('blocks when a required heading is missing', () => {
    const file = makeTempFile(missingHeadingDoc())

    const result = runCli(['--file', file, '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.ok).toBe(false)
    expect(parsed.status).toBe('blocked')
    expect(parsed.missingHeadings).toContain('## Boundary checks')
    expect(parsed.missingPhrases).toEqual([])
  })

  it('blocks when a required phrase is missing', () => {
    const file = makeTempFile(missingPhraseDoc())

    const result = runCli(['--file', file, '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.ok).toBe(false)
    expect(parsed.status).toBe('blocked')
    expect(parsed.missingHeadings).toEqual([])
    expect(parsed.missingPhrases).toContain('mailing')
  })

  it('treats missing optional notes as pending in non-strict mode', () => {
    const file = makeTempFile(pendingDoc())

    const loose = runCli(['--file', file])
    expect(loose.exitCode).toBe(0)
    expect(loose.stdout).toContain('Status: `pending`')
    expect(loose.stdout).toContain('optional notes section missing')

    const strict = runCli(['--file', file, '--strict', '--json'])
    const parsed = JSON.parse(strict.stdout)

    expect(strict.exitCode).toBe(3)
    expect(parsed.ok).toBe(false)
    expect(parsed.status).toBe('pending')
    expect(parsed.warnings).toContain('optional notes section missing')
  })

  it('returns usage text on help', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('validate-worker-secrets-trust-model.js')
  })

  it('exposes the pure inspection helper', () => {
    const result = inspectTrustModel(completeDoc(), '/tmp/worker-secrets-trust-model.md')

    expect(result.ok).toBe(true)
    expect(result.status).toBe('complete')
    expect(result.optionalNotesPresent).toBe(true)
  })
})
