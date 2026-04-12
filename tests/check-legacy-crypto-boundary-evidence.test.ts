import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  REQUIRED_RUNTIME_FILES,
  REQUIRED_TEST_FILES,
} from '../scripts/check-legacy-crypto-boundary-evidence.js'

const scriptPath = fileURLToPath(new URL('../scripts/check-legacy-crypto-boundary-evidence.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'legacy-crypto-evidence-'))
  tempDirs.push(root)
  return root
}

function writeText(filePath: string, text: string) {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, `${text}\n`, 'utf8')
}

function seedRequiredEvidence(root: string) {
  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    writeText(join(root, relativePath), `// fixture for ${relativePath}`)
  }

  for (const relativePath of REQUIRED_TEST_FILES) {
    writeText(join(root, relativePath), `// fixture for ${relativePath}`)
  }
}

function runCheck(root: string, args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

describe('check-legacy-crypto-boundary-evidence.js', () => {
  it('passes in json mode when all required files exist and source has no legacy imports/signing patterns', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    writeText(
      join(root, 'src', 'runtime', 'crypto', 'hmac.ts'),
      [
        "import { createHmac } from 'node:crypto'",
        'export function verifyHmacSignature(input: string) {',
        "  return createHmac('sha256', 'secret').update(input).digest('hex')",
        '}',
      ].join('\n'),
    )
    writeText(
      join(root, 'src', 'webhooks.ts'),
      [
        "import { verifyHmacSignature } from './runtime/crypto/hmac'",
        'export const verify = (body: string) => verifyHmacSignature(body)',
      ].join('\n'),
    )

    const res = runCheck(root, ['--json'])
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')

    const payload = JSON.parse(res.stdout)
    expect(payload.status).toBe('pass')
    expect(payload.strict).toBe(false)
    expect(payload.runtimeFileCount).toBe(REQUIRED_RUNTIME_FILES.length)
    expect(payload.testCount).toBe(REQUIRED_TEST_FILES.length)
    expect(payload.importFindingCount).toBe(0)
    expect(payload.forbiddenSigningFindingCount).toBe(0)
  })

  it('reports missing files, legacy imports, and forbidden signing patterns', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    rmSync(join(root, REQUIRED_RUNTIME_FILES[1]), { force: true })
    rmSync(join(root, REQUIRED_TEST_FILES[2]), { force: true })
    writeText(
      join(root, 'src', 'bridge.ts'),
      [
        "import legacyCrypto from '../../libs/legacy/blackcat-crypto/src/index.js'",
        'export default legacyCrypto',
      ].join('\n'),
    )
    writeText(
      join(root, 'src', 'runtime', 'crypto', 'safeCompare.ts'),
      [
        "import crypto from 'node:crypto'",
        'export function dangerousSign(payload: string) {',
        "  return crypto.sign('sha256', Buffer.from(payload), Buffer.from('x'))",
        '}',
      ].join('\n'),
    )

    const res = runCheck(root, ['--json'])
    expect(res.status).toBe(0)

    const payload = JSON.parse(res.stdout)
    expect(payload.status).toBe('issues-found')
    expect(payload.runtimeMissing).toContain(REQUIRED_RUNTIME_FILES[1])
    expect(payload.testMissing).toContain(REQUIRED_TEST_FILES[2])
    expect(payload.importFindingCount).toBe(1)
    expect(payload.forbiddenSigningFindingCount).toBeGreaterThanOrEqual(1)
  })

  it('exits 3 in strict mode when legacy import or signing findings are present', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    writeText(
      join(root, 'src', 'runtime', 'crypto', 'boundary.ts'),
      [
        'export function unsafe() {',
        '  return createPrivateKey("abc")',
        '}',
      ].join('\n'),
    )
    writeText(
      join(root, 'src', 'runtime', 'crypto', 'bridge.ts'),
      [
        "import cryptoBridge from '../../../libs/legacy/blackcat-crypto/src/index.js'",
        'export default cryptoBridge',
      ].join('\n'),
    )

    const res = runCheck(root, ['--strict'])
    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Legacy Crypto Boundary Evidence')
    expect(res.stdout).toContain('Legacy import findings')
    expect(res.stdout).toContain('Forbidden signing findings')
  })

  it('shows help text and usage errors', () => {
    const helpRes = runCheck(makeTempRoot(), ['--help'])
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('Usage:')
    expect(helpRes.stdout).toContain('--root <dir>')

    const usageRes = runCheck(makeTempRoot(), ['--root'])
    expect(usageRes.status).toBe(64)
    expect(usageRes.stderr).toContain('missing value for --root')
  })
})
