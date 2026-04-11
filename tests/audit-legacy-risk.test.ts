import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/audit-legacy-risk.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempLegacyTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'legacy-risk-'))
  tempDirs.push(root)
  const legacyRoot = join(root, 'libs', 'legacy')

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = join(legacyRoot, relativePath)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, `${contents}\n`, 'utf8')
  }

  return legacyRoot
}

function runAudit(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('audit-legacy-risk.js', () => {
  it('returns warnings only in strict mode without failing when no critical findings exist', () => {
    const legacyRoot = makeTempLegacyTree({
      'alpha/src/app.js': [
        "import { exec } from 'node:child_process'",
        'const apiSecret = process.env.API_SECRET',
        "exec('whoami')",
        'const query = "SELECT * FROM users WHERE id = " + userId',
        'eval("1 + 1") // audit: allow-risk',
      ].join('\n'),
    })

    const res = runAudit(['--dir', legacyRoot, '--strict'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Legacy Risk Audit')
    expect(res.stdout).toContain('Strict mode: `on`')
    expect(res.stdout).toContain('### warning')
    expect(res.stdout).toContain('js-child-process-call')
    expect(res.stdout).toContain('js-secret-env')
    expect(res.stdout).toContain('generic-sql-injection-hint')
    expect(res.stdout).not.toContain('js-eval')
  })

  it('groups critical findings by module and exits 3 in strict mode', () => {
    const legacyRoot = makeTempLegacyTree({
      'alpha/src/app.js': [
        "import { spawn } from 'node:child_process'",
        "spawn('sh', ['-c', 'echo hi'], { shell: true })",
        'const helper = new Function("return 1")',
      ].join('\n'),
      'beta/src/index.php': [
        '<?php',
        "$page = $_GET['page'];",
        'include($page);',
        "system('ls -la');",
        "$header = 'Bearer abcdefghijklmnopqrstuvwxyz123456';",
      ].join('\n'),
      'gamma/config/secrets.env': 'PRIVATE_KEY="-----BEGIN PRIVATE KEY-----"',
    })

    const res = runAudit(['--dir', legacyRoot, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('## alpha')
    expect(res.stdout).toContain('## beta')
    expect(res.stdout).toContain('## gamma')
    expect(res.stdout).toContain('### critical')
    expect(res.stdout).toContain('js-child-process-shell')
    expect(res.stdout).toContain('js-new-function')
    expect(res.stdout).toContain('php-dynamic-include')
    expect(res.stdout).toContain('php-dangerous-function')
    expect(res.stdout).toContain('generic-bearer-token')
    expect(res.stdout).toContain('generic-private-key')
    expect(res.stdout).toContain('`alpha/src/app.js:2`')
    expect(res.stdout).toContain('`beta/src/index.php:3`')
    expect(res.stdout).toContain('`gamma/config/secrets.env:1`')
  })

  it('prints structured JSON only and rejects usage errors', () => {
    const legacyRoot = makeTempLegacyTree({
      'alpha/src/app.js': [
        "import { exec } from 'node:child_process'",
        'const apiSecret = process.env.API_SECRET',
        "exec('whoami')",
      ].join('\n'),
    })

    const jsonRes = runAudit(['--dir', legacyRoot, '--json'])

    expect(jsonRes.status).toBe(0)
    expect(jsonRes.stderr).toBe('')
    expect(jsonRes.stdout.trim().startsWith('{')).toBe(true)
    expect(jsonRes.stdout.trim().endsWith('}')).toBe(true)

    const parsed = JSON.parse(jsonRes.stdout)
    expect(parsed).toMatchObject({
      inputDir: legacyRoot,
      strict: false,
      totals: {
        critical: 0,
        warning: 2,
        info: 0,
        findings: 2,
      },
    })
    expect(parsed.modules).toHaveLength(1)
    expect(parsed.modules[0]).toMatchObject({
      module: 'alpha',
      findings: {
        warning: [
          expect.objectContaining({ rule: 'js-secret-env', line: 2 }),
          expect.objectContaining({ rule: 'js-child-process-call', line: 3 }),
        ],
      },
    })

    const helpRes = runAudit(['--help'])
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('Usage:')
    expect(helpRes.stdout).toContain('--dir <path>')

    const badValueRes = runAudit(['--dir'])
    expect(badValueRes.status).toBe(64)
    expect(badValueRes.stderr).toContain('missing value for --dir')

    const badOptionRes = runAudit(['--nope'])
    expect(badOptionRes.status).toBe(64)
    expect(badOptionRes.stderr).toContain('unknown option: --nope')
  })
})
