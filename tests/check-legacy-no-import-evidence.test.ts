import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-legacy-no-import-evidence.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'legacy-no-import-'))
  tempDirs.push(root)
  return root
}

function writeText(filePath: string, text: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, text, 'utf8')
}

function makeFixture({
  srcFiles,
}: {
  srcFiles: Record<string, string>
}) {
  const root = makeTempRoot()

  for (const [relativePath, contents] of Object.entries(srcFiles)) {
    writeText(join(root, 'src', relativePath), `${contents}\n`)
  }

  return root
}

function runCheck(root: string, args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

describe('check-legacy-no-import-evidence.js', () => {
  it('prints structured JSON and passes with built-in legacy module list', () => {
    const root = makeFixture({
      srcFiles: {
        'handler.ts': [
          "import { createHash } from 'node:crypto'",
          "import { readFile } from './runtime/io'",
          '',
          'export function bootstrap() {',
          "  return createHash('sha256').digest('hex')",
          '}',
        ].join('\n'),
        'runtime/io.ts': "export async function readFile() { return 'ok' }",
      },
    })

    const res = runCheck(root, ['--json'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(() => JSON.parse(res.stdout)).not.toThrow()

    const report = JSON.parse(res.stdout)
    expect(report.status).toBe('pass')
    expect(report.moduleSource).toBe('builtin')
    expect(report.moduleCount).toBe(11)
    expect(report.referencedModuleCount).toBe(0)
    expect(report.findingCount).toBe(0)
    expect(report.modules.some((module: { module: string }) => module.module === 'blackcat-analytics')).toBe(true)
    expect(report.modules.some((module: { module: string }) => module.module === 'blackcat-auth')).toBe(true)
    expect(res.stdout).toContain('"strict": false')
  })

  it('reports legacy references from a provided module list and exits 3 in strict mode', () => {
    const root = makeFixture({
      srcFiles: {
        'app.ts': [
          "import authBridge from '../../libs/legacy/blackcat-auth/src/index.ts'",
          'export const bridge = authBridge',
        ].join('\n'),
      },
    })

    const res = runCheck(root, ['--modules', 'blackcat-auth,blackcat-crypto', '--json', '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')

    const report = JSON.parse(res.stdout)
    expect(report.status).toBe('issues-found')
    expect(report.moduleSource).toBe('provided')
    expect(report.manifestPath).toBeNull()
    expect(report.moduleCount).toBe(2)
    expect(report.referencedModuleCount).toBe(1)
    expect(report.findingCount).toBe(1)
    expect(report.modules).toEqual([
      {
        module: 'blackcat-auth',
        legacyPath: 'libs/legacy/blackcat-auth',
        referenced: true,
        findingCount: 1,
        references: [
          {
            module: 'blackcat-auth',
            legacyPath: 'libs/legacy/blackcat-auth',
            file: 'src/app.ts',
            line: 1,
            kind: 'import',
            specifier: '../../libs/legacy/blackcat-auth/src/index.ts',
          },
        ],
      },
      {
        module: 'blackcat-crypto',
        legacyPath: 'libs/legacy/blackcat-crypto',
        referenced: false,
        findingCount: 0,
        references: [],
      },
    ])
    expect(report.findings).toEqual([
      {
        module: 'blackcat-auth',
        legacyPath: 'libs/legacy/blackcat-auth',
        file: 'src/app.ts',
        line: 1,
        kind: 'import',
        specifier: '../../libs/legacy/blackcat-auth/src/index.ts',
      },
    ])
  })
})
