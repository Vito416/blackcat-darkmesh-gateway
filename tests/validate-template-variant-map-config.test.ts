import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENV_VAR, runCli } from '../scripts/validate-template-variant-map-config.js'

const VALID_TEMPLATE_TX = 'A'.repeat(43)
const VALID_MANIFEST_TX = 'B'.repeat(43)
const VALID_TEMPLATE_TX_2 = 'C'.repeat(43)
const VALID_MANIFEST_TX_2 = 'D'.repeat(43)
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function buildValidMap() {
  return {
    alpha: {
      variant: 'signal',
      templateTxId: VALID_TEMPLATE_TX,
      manifestTxId: VALID_MANIFEST_TX,
    },
    beta: {
      variant: 'bastion',
      templateTxId: VALID_TEMPLATE_TX_2,
      manifestTxId: VALID_MANIFEST_TX_2,
    },
  }
}

function writeMapFile(map: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'variant-map-'))
  tempDirs.push(dir)
  const file = join(dir, 'template-variant-map.json')
  writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  return file
}

describe('validate-template-variant-map-config.js', () => {
  it('passes strict validation when reading a valid file map', async () => {
    const file = writeMapFile(buildValidMap())
    const result = await runCli(['--file', file, '--strict', '--require-sites', 'alpha,beta', '--json'], {})
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('complete')
    expect(payload.source.type).toBe('file')
    expect(payload.counts.providedCount).toBe(2)
    expect(payload.issues).toEqual([])
  })

  it('passes strict validation when reading from env', async () => {
    const env = {
      [ENV_VAR]: JSON.stringify(buildValidMap()),
    }
    const result = await runCli(['--strict', '--require-sites', 'alpha,beta', '--json'], env)
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('complete')
    expect(payload.source.type).toBe('env')
    expect(payload.counts.requiredCount).toBe(2)
  })

  it('fails strict mode when required sites are missing', async () => {
    const map = buildValidMap()
    delete map.beta
    const env = {
      [ENV_VAR]: JSON.stringify(map),
    }

    const result = await runCli(['--strict', '--require-sites', 'alpha,beta', '--json'], env)
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.issues.join('\n')).toContain('missing required sites: beta')
  })

  it('fails strict mode on malformed entries and invalid txid shape', async () => {
    const env = {
      [ENV_VAR]: JSON.stringify({
        alpha: {
          variant: 'signal',
          templateTxId: 'not-a-txid',
          manifestTxId: VALID_MANIFEST_TX,
        },
      }),
    }

    const result = await runCli(['--strict', '--require-sites', 'alpha', '--json'], env)
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.counts.invalidTxIdCount).toBe(1)
    expect(payload.issues.join('\n')).toContain('Arweave txid-like value')
  })

  it('fails when placeholders are present and --allow-placeholders is not set', async () => {
    const env = {
      [ENV_VAR]: JSON.stringify({
        alpha: {
          variant: 'signal',
          templateTxId: 'REPLACE_WITH_TEMPLATE_TXID',
          manifestTxId: 'REPLACE_WITH_MANIFEST_TXID',
        },
      }),
    }

    const result = await runCli(['--json'], env)
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.issues.join('\n')).toContain('placeholder value')
  })

  it('accepts placeholders when --allow-placeholders is set', async () => {
    const env = {
      [ENV_VAR]: JSON.stringify({
        alpha: {
          variant: 'horizon',
          templateTxId: 'REPLACE_WITH_TEMPLATE_TXID',
          manifestTxId: 'REPLACE_WITH_MANIFEST_TXID',
        },
      }),
    }

    const result = await runCli(['--allow-placeholders', '--strict', '--require-sites', 'alpha', '--json'], env)
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('complete')
    expect(payload.counts.placeholderCount).toBe(2)
  })
})
