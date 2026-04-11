import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  REQUIRED_RUNTIME_FILES,
  REQUIRED_TEST_FILES,
} from '../scripts/check-legacy-core-extraction-evidence.js'

const scriptPath = fileURLToPath(new URL('../scripts/check-legacy-core-extraction-evidence.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'legacy-core-evidence-'))
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

describe('check-legacy-core-extraction-evidence.js', () => {
  it('passes in json mode when all required runtime files and tests exist and src has no legacy imports', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    writeText(
      join(root, 'src', 'app.ts'),
      [
        "import { createHash } from 'node:crypto'",
        "import { buildTemplateActionPolicy } from './runtime/template/actions'",
        '',
        'export const ok = createHash("sha256").digest("hex")',
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
    expect(payload.runtimeMissing).toEqual([])
    expect(payload.testMissing).toEqual([])
  })

  it('reports missing runtime files and tests without failing non-strict validation', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    rmSync(join(root, REQUIRED_RUNTIME_FILES[3]), { force: true })
    rmSync(join(root, REQUIRED_TEST_FILES[4]), { force: true })
    writeText(
      join(root, 'src', 'feature.ts'),
      [
        "import legacyCore from '../../libs/legacy/blackcat-core/src/index.js'",
        'export default legacyCore',
      ].join('\n'),
    )

    const res = runCheck(root, ['--json'])
    expect(res.status).toBe(0)

    const payload = JSON.parse(res.stdout)
    expect(payload.status).toBe('issues-found')
    expect(payload.runtimeMissing).toContain(REQUIRED_RUNTIME_FILES[3])
    expect(payload.testMissing).toContain(REQUIRED_TEST_FILES[4])
    expect(payload.importFindingCount).toBe(1)
    expect(payload.importFindings[0].file).toBe('src/feature.ts')
    expect(payload.importFindings[0].line).toBe(1)
  })

  it('exits 3 in strict mode when src still references blackcat-core', () => {
    const root = makeTempRoot()
    seedRequiredEvidence(root)
    writeText(
      join(root, 'src', 'runtime', 'core', 'bridge.ts'),
      [
        "import coreBridge from '../../../libs/legacy/blackcat-core/src/index.js'",
        'export default coreBridge',
      ].join('\n'),
    )

    const res = runCheck(root, ['--strict'])
    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Legacy Core Extraction Evidence')
    expect(res.stdout).toContain('Legacy core import findings')
    expect(res.stdout).toContain('libs/legacy/blackcat-core')
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
