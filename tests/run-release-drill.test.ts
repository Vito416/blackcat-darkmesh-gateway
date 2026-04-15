import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { runCli, runReleaseDrill } from '../scripts/run-release-drill.js'

const tempDirs: string[] = []
const TEMPLATE_URL_MAP_ENV = 'GATEWAY_TEMPLATE_WORKER_URL_MAP'
const TEMPLATE_TOKEN_MAP_ENV = 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP'
const TEMPLATE_SIGNATURE_REF_MAP_ENV = 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP'
const TEMPLATE_VARIANT_MAP_ENV = 'GATEWAY_TEMPLATE_VARIANT_MAP'
const FORGET_FORWARD_URL_ENV = 'GATEWAY_FORGET_FORWARD_URL'
const FORGET_FORWARD_TOKEN_ENV = 'GATEWAY_FORGET_FORWARD_TOKEN'
const FORGET_FORWARD_TIMEOUT_ENV = 'GATEWAY_FORGET_FORWARD_TIMEOUT_MS'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env[TEMPLATE_URL_MAP_ENV]
  delete process.env[TEMPLATE_TOKEN_MAP_ENV]
  delete process.env[TEMPLATE_SIGNATURE_REF_MAP_ENV]
  delete process.env[TEMPLATE_VARIANT_MAP_ENV]
  delete process.env[FORGET_FORWARD_URL_ENV]
  delete process.env[FORGET_FORWARD_TOKEN_ENV]
  delete process.env[FORGET_FORWARD_TIMEOUT_ENV]
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function withEnvVars(values: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (typeof value === 'undefined') {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (typeof value === 'undefined') {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'release-drill-'))
  tempDirs.push(dir)
  return dir
}

function makeSpawnResult(stdout: string, stderr = '', status = 0) {
  return {
    status,
    stdout,
    stderr,
    error: null,
    signal: null,
  }
}

describe('run-release-drill.js', () => {
  it('prints help text', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('node scripts/run-release-drill.js')
    expect(result.stdout).toContain('Sequence:')
    expect(result.stderr).toBe('')
  })

  it('prints a dry-run plan without executing child steps', () => {
    let result
    withEnvVars(
      {
        [TEMPLATE_URL_MAP_ENV]: undefined,
        [TEMPLATE_TOKEN_MAP_ENV]: undefined,
        [TEMPLATE_SIGNATURE_REF_MAP_ENV]: undefined,
        [TEMPLATE_VARIANT_MAP_ENV]: undefined,
        [FORGET_FORWARD_URL_ENV]: undefined,
        [FORGET_FORWARD_TOKEN_ENV]: undefined,
        [FORGET_FORWARD_TIMEOUT_ENV]: undefined,
      },
      () => {
        result = runCli([
          '--urls',
          'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
          '--out-dir',
          './tmp/release-drill',
          '--profile',
          'diskless',
          '--mode',
          'all',
          '--allow-anon',
          '--release',
          '2.0.0',
          '--strict',
          '--dry-run',
        ])
      },
    )

    expect(result?.exitCode).toBe(0)
    expect(result?.stdout).toContain('Dry run: release drill')
    expect(result?.stdout).toContain('1) validate consistency preflight')
    expect(result?.stdout).toContain('scripts/compare-integrity-matrix.js')
    expect(result?.stdout).toContain('scripts/compare-integrity-matrix.js --url https://gw-a.example/integrity/state --url https://gw-b.example/integrity/state --mode all --json --allow-anon')
    expect(result?.stdout).toContain('scripts/export-integrity-evidence.js')
    expect(result?.stdout).toContain('scripts/export-integrity-evidence.js --url https://gw-a.example/integrity/state --url https://gw-b.example/integrity/state --out-dir')
    expect(result?.stdout).toContain('--allow-anon')
    expect(result?.stdout).toContain('scripts/latest-evidence-bundle.js')
    expect(result?.stdout).toContain('scripts/check-evidence-bundle.js')
    expect(result?.stdout).toContain('scripts/check-legacy-core-extraction-evidence.js')
    expect(result?.stdout).toContain('scripts/check-legacy-crypto-boundary-evidence.js')
    expect(result?.stdout).toContain('scripts/check-template-worker-map-coherence.js --json')
    expect(result?.stdout).toContain('scripts/check-forget-forward-config.js --json')
    expect(result?.stdout).toContain('scripts/check-template-signature-ref-map.js --json')
    expect(result?.stdout).toContain('scripts/check-template-variant-map.js --json')
    expect(result?.stdout).toContain('legacy-crypto-boundary-evidence.json')
    expect(result?.stdout).toContain('template-worker-map-coherence.json')
    expect(result?.stdout).toContain('forget-forward-config.json')
    expect(result?.stdout).toContain('template-variant-map.json')
    expect(result?.stdout).toContain('release-drill-checks.json')
    expect(result?.stdout).toContain('release-evidence-pack.json')
    expect(result?.stdout).toContain('release-readiness.json')
    expect(result?.stdout).toContain('scripts/build-release-drill-manifest.js')
    expect(result?.stdout).toContain('scripts/validate-release-drill-manifest.js')
    expect(result?.stdout).toContain('scripts/check-release-drill-artifacts.js')
    expect(result?.stdout).toContain('scripts/build-release-evidence-ledger.js')
    expect(result?.stdout).toContain('Strict readiness: yes')
    expect(result?.stderr).toBe('')
  })

  it('uses auto-generated output directory when --out-dir is omitted', () => {
    const result = runCli([
      '--urls',
      'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
      '--allow-anon',
      '--dry-run',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Out dir: ')
    expect(result.stdout).toContain('tmp/release-drills')
    expect(result.stdout).toMatch(/1\.4\.0-vps_medium-pairwise-/)
    expect(result.stderr).toBe('')
  })

  it('fails when --out-dir and --out-root are used together', () => {
    const result = runCli([
      '--urls',
      'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
      '--out-dir',
      './tmp/release-drill',
      '--out-root',
      './tmp/release-drills',
      '--dry-run',
    ])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: use only one of --out-dir or --out-root')
  })

  it('returns a usage error when required arguments are missing', () => {
    const result = runCli(['--out-dir', './tmp/release-drill'])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --urls is required')
  })

  it('orchestrates the release drill through injected child-process results', () => {
    const outDir = makeTempDir()
    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      const scriptPath = String(args[0] ?? '')
      const scriptName = scriptPath.split('/').pop() ?? scriptPath.split('\\').pop() ?? ''

      if (scriptName === 'validate-consistency-preflight.js') {
        return makeSpawnResult(
          [
            'Consistency preflight passed',
            'URLs: 2',
            'Mode: pairwise',
            'Profile: vps_medium',
            'Auth: token provided',
          ].join('\n'),
        )
      }

      if (scriptName === 'compare-integrity-matrix.js') {
        return makeSpawnResult(
          JSON.stringify({
            exitCode: 0,
            counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
            runs: [{ index: 1, status: 'PASS' }],
          }, null, 2),
        )
      }

      if (scriptName === 'export-consistency-report.js') {
        const reportPath = join(outDir, 'consistency-drift-report.md')
        const summaryPath = join(outDir, 'consistency-drift-summary.json')
        writeFileSync(reportPath, '# Multi-region drift report\n', 'utf8')
        writeFileSync(
          summaryPath,
          JSON.stringify({ profile: 'vps_medium', status: 'ok', counts: { total: 1 } }, null, 2),
          'utf8',
        )
        return makeSpawnResult(
          [
            `[export-consistency-report] wrote drift report to ${reportPath}`,
            `[export-consistency-report] wrote drift summary to ${summaryPath}`,
          ].join('\n'),
        )
      }

      if (scriptName === 'export-integrity-evidence.js') {
        const evidenceRoot = join(outDir, 'evidence')
        const bundleDir = join(evidenceRoot, '2026-04-11T12-00-00Z-abc')
        mkdirSync(bundleDir, { recursive: true })
        writeFileSync(join(bundleDir, 'compare.txt'), 'comparison ok\n', 'utf8')
        writeFileSync(join(bundleDir, 'attestation.json'), '{"ok":true}\n', 'utf8')
        writeFileSync(join(bundleDir, 'manifest.json'), '{"ok":true}\n', 'utf8')
        return makeSpawnResult('evidence bundle exported\n')
      }

      if (scriptName === 'latest-evidence-bundle.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              bundleDir: join(outDir, 'evidence', '2026-04-11T12-00-00Z-abc'),
              bundleName: '2026-04-11T12-00-00Z-abc',
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-evidence-bundle.js') {
        return makeSpawnResult('valid evidence bundle (strict)\n')
      }

      if (scriptName === 'validate-ao-dependency-gate.js') {
        return makeSpawnResult(`valid dependency gate: ${args[2]}`)
      }

      if (scriptName === 'check-legacy-core-extraction-evidence.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              status: 'complete',
              strict: true,
              envVar: 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP',
              requiredSites: [],
              providedSites: [],
              missingSites: [],
              counts: {
                providedCount: 0,
                requiredCount: 0,
                missingCount: 0,
                emptyValueCount: 0,
              },
              issues: [],
              warnings: [],
              findings: [],
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-legacy-crypto-boundary-evidence.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              status: 'pass',
              strict: true,
              importFindingCount: 0,
              forbiddenSigningFindingCount: 0,
              runtimeMissing: [],
              testMissing: [],
              importFindings: [],
              forbiddenSigningFindings: [],
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-template-worker-map-coherence.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              status: 'complete',
              strict: true,
              envVars: {
                urlMap: 'GATEWAY_TEMPLATE_WORKER_URL_MAP',
                tokenMap: 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP',
                signatureRefMap: 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP',
              },
              requiredSites: [],
              issues: [],
              warnings: [],
              maps: {
                url: {
                  alpha: 'https://gw-a.example/template',
                  beta: 'https://gw-b.example/template',
                },
                token: {
                  alpha: 'token-alpha',
                  beta: 'token-beta',
                },
                signatureRef: {
                  alpha: 'sig-alpha',
                  beta: 'sig-beta',
                },
              },
              counts: {
                urlMapCount: 2,
                tokenMapCount: 2,
                signatureRefMapCount: 2,
                requiredSiteCount: 0,
                missingRequiredSiteCount: 0,
                missingTokenCount: 0,
                missingSignatureRefCount: 0,
                extraTokenCount: 0,
                extraSignatureRefCount: 0,
              },
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-forget-forward-config.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              strict: false,
              status: 'complete',
              envVars: {
                url: 'GATEWAY_FORGET_FORWARD_URL',
                token: 'GATEWAY_FORGET_FORWARD_TOKEN',
                timeoutMs: 'GATEWAY_FORGET_FORWARD_TIMEOUT_MS',
              },
              values: {
                url: 'https://forward.example/forget',
                token: 'relay-token',
                timeoutMs: 5000,
                timeoutSource: 'env',
              },
              present: {
                url: true,
                token: true,
                timeoutMs: true,
              },
              counts: {
                configuredCount: 3,
                issueCount: 0,
                warningCount: 0,
              },
              issues: [],
              warnings: [],
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-template-signature-ref-map.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              status: 'complete',
              strict: true,
              envVar: 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP',
              requiredSites: ['alpha', 'beta'],
              providedSites: ['alpha', 'beta'],
              missingSites: [],
              counts: {
                providedCount: 2,
                requiredCount: 2,
                missingCount: 0,
                emptyValueCount: 0,
              },
              issues: [],
              warnings: [],
              map: {
                alpha: 'sig-alpha',
                beta: 'sig-beta',
              },
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-template-variant-map.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              status: 'complete',
              strict: true,
              envVar: 'GATEWAY_TEMPLATE_VARIANT_MAP',
              requiredSites: ['alpha', 'beta'],
              allowedVariants: ['signal', 'bastion', 'horizon'],
              providedSites: ['alpha', 'beta'],
              missingSites: [],
              counts: {
                providedCount: 2,
                requiredCount: 2,
                missingCount: 0,
              },
              issues: [],
              warnings: [],
              map: {
                alpha: {
                  variant: 'signal',
                  templateTxId: 'tx-alpha',
                  manifestTxId: 'manifest-alpha',
                },
                beta: {
                  variant: 'bastion',
                  templateTxId: 'tx-beta',
                  manifestTxId: 'manifest-beta',
                },
              },
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'build-release-evidence-pack.js') {
        const packMd = join(outDir, 'release-evidence-pack.md')
        const packJson = join(outDir, 'release-evidence-pack.json')
        const pack = {
          createdAt: '2026-04-11T12:00:00.000Z',
          release: '2.0.0',
          status: 'ready',
          blockers: [],
          warnings: [],
          consistency: { present: true, status: 'pass', reason: 'all runs matched' },
          evidence: { present: true, status: 'pass', reason: 'latest bundle strict markers are ok' },
          aoGate: { present: true, status: 'pass', reason: 'all required AO dependency checks are closed' },
        }
        writeFileSync(packMd, '# Release Evidence Pack\n', 'utf8')
        writeFileSync(packJson, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
        return makeSpawnResult('# Release Evidence Pack\n')
      }

      if (scriptName === 'build-release-signoff-checklist.js') {
        const checklistPath = join(outDir, 'release-signoff-checklist.md')
        writeFileSync(checklistPath, '# Release Sign-off Checklist\n', 'utf8')
        return makeSpawnResult('# Release Sign-off Checklist\n')
      }

      if (scriptName === 'check-release-readiness.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              status: 'ready',
              blockerCount: 0,
              warningCount: 0,
              release: '2.0.0',
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'build-release-drill-manifest.js') {
        const manifestPath = join(outDir, 'release-drill-manifest.json')
        writeFileSync(
          manifestPath,
          `${JSON.stringify(
            {
              release: '2.0.0',
              status: 'ready',
              artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 123, sha256: 'a'.repeat(64) }],
            },
            null,
            2,
          )}\n`,
          'utf8',
        )
        return makeSpawnResult(`# Release Drill Manifest\n- Output: ${manifestPath}\n`)
      }

      if (scriptName === 'validate-release-drill-manifest.js') {
        return makeSpawnResult('valid release drill manifest: /tmp/release-drill-manifest.json\n')
      }

      if (scriptName === 'check-release-drill-artifacts.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              requiredCount: 10,
              presentCount: 10,
              missing: [],
              issues: [],
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'build-release-evidence-ledger.js') {
        const ledgerMd = join(outDir, 'release-evidence-ledger.md')
        const ledgerJson = join(outDir, 'release-evidence-ledger.json')
        writeFileSync(ledgerMd, '# Release Evidence Ledger\n', 'utf8')
        writeFileSync(
          ledgerJson,
          `${JSON.stringify(
            {
              decision: 'pending',
              release: '2.0.0',
              overallStatus: 'ready',
              checks: {
                packReady: true,
                readinessReady: true,
                drillCheckOk: true,
                manifestValidated: true,
                aoGateValidated: true,
              },
            },
            null,
            2,
          )}\n`,
          'utf8',
        )
        return makeSpawnResult('# Release Evidence Ledger\n')
      }

      return makeSpawnResult('', `unexpected script: ${scriptName}`, 3)
    })

    let result
    withEnvVars(
      {
        [TEMPLATE_URL_MAP_ENV]: JSON.stringify({
          alpha: 'https://gw-a.example/template',
          beta: 'https://gw-b.example/template',
        }),
        [TEMPLATE_TOKEN_MAP_ENV]: JSON.stringify({
          alpha: 'token-alpha',
          beta: 'token-beta',
        }),
        [TEMPLATE_SIGNATURE_REF_MAP_ENV]: JSON.stringify({
          alpha: 'sig-alpha',
          beta: 'sig-beta',
        }),
        [TEMPLATE_VARIANT_MAP_ENV]: JSON.stringify({
          alpha: {
            variant: 'signal',
            templateTxId: 'tx-alpha',
            manifestTxId: 'manifest-alpha',
          },
          beta: {
            variant: 'bastion',
            templateTxId: 'tx-beta',
            manifestTxId: 'manifest-beta',
          },
        }),
        [FORGET_FORWARD_URL_ENV]: 'https://forward.example/forget',
        [FORGET_FORWARD_TOKEN_ENV]: 'relay-token',
        [FORGET_FORWARD_TIMEOUT_ENV]: '5000',
      },
      () => {
        result = runReleaseDrill(
          {
            urlsCsv: 'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
            outDir,
            profile: 'vps_medium',
            mode: 'pairwise',
            token: 'shared-token',
            allowAnon: false,
            release: '2.0.0',
            strict: true,
          },
          { spawnSyncFn },
        )
      },
    )

    expect(result?.exitCode).toBe(0)
    expect(spawnSyncFn).toHaveBeenCalledTimes(20)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'validate-consistency-preflight.js',
      'compare-integrity-matrix.js',
      'export-consistency-report.js',
      'export-integrity-evidence.js',
      'latest-evidence-bundle.js',
      'check-evidence-bundle.js',
      'validate-ao-dependency-gate.js',
      'check-legacy-core-extraction-evidence.js',
      'check-legacy-crypto-boundary-evidence.js',
      'check-template-worker-map-coherence.js',
      'check-forget-forward-config.js',
      'check-template-signature-ref-map.js',
      'check-template-variant-map.js',
      'build-release-evidence-pack.js',
      'build-release-signoff-checklist.js',
      'check-release-readiness.js',
      'build-release-drill-manifest.js',
      'validate-release-drill-manifest.js',
      'check-release-drill-artifacts.js',
      'build-release-evidence-ledger.js',
    ])
    expect(result?.stdout).toContain('[1/20] validate consistency preflight')
    expect(result?.stdout).toContain('# Release Evidence Pack')
    expect(result?.stdout).toContain('# Release Sign-off Checklist')
    expect(result?.stdout).toContain('# Release Evidence Ledger')
    expect(result?.stdout).toContain('"status": "ready"')
    expect(result?.stderr).toBe('')

    const matrix = JSON.parse(readFileSync(join(outDir, 'consistency-matrix.json'), 'utf8'))
    const legacyCoreEvidence = JSON.parse(readFileSync(join(outDir, 'legacy-core-extraction-evidence.json'), 'utf8'))
    const legacyCryptoEvidence = JSON.parse(readFileSync(join(outDir, 'legacy-crypto-boundary-evidence.json'), 'utf8'))
    const templateWorkerMapCoherence = JSON.parse(readFileSync(join(outDir, 'template-worker-map-coherence.json'), 'utf8'))
    const forgetForwardConfig = JSON.parse(readFileSync(join(outDir, 'forget-forward-config.json'), 'utf8'))
    const signatureRefMap = JSON.parse(readFileSync(join(outDir, 'template-signature-ref-map.json'), 'utf8'))
    const variantMap = JSON.parse(readFileSync(join(outDir, 'template-variant-map.json'), 'utf8'))
    const drillChecks = JSON.parse(readFileSync(join(outDir, 'release-drill-checks.json'), 'utf8'))
    const pack = JSON.parse(readFileSync(join(outDir, 'release-evidence-pack.json'), 'utf8'))
    const latest = JSON.parse(readFileSync(join(outDir, 'latest-evidence-bundle.json'), 'utf8'))
    const readiness = JSON.parse(readFileSync(join(outDir, 'release-readiness.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(outDir, 'release-drill-manifest.json'), 'utf8'))
    const manifestValidation = readFileSync(join(outDir, 'release-drill-manifest.validation.txt'), 'utf8')
    const drillCheck = JSON.parse(readFileSync(join(outDir, 'release-drill-check.json'), 'utf8'))
    const ledger = JSON.parse(readFileSync(join(outDir, 'release-evidence-ledger.json'), 'utf8'))
    const ledgerMd = readFileSync(join(outDir, 'release-evidence-ledger.md'), 'utf8')
    const aoGateValidation = readFileSync(join(outDir, 'ao-dependency-gate.validation.txt'), 'utf8')
    expect(legacyCoreEvidence.ok).toBe(true)
    expect(legacyCryptoEvidence.ok).toBe(true)
    expect(templateWorkerMapCoherence.status).toBe('complete')
    expect(templateWorkerMapCoherence.configured).toBe(true)
    expect(forgetForwardConfig.status).toBe('complete')
    expect(forgetForwardConfig.present.url).toBe(true)
    expect(signatureRefMap.ok).toBe(true)
    expect(signatureRefMap.requiredSites).toEqual(['alpha', 'beta'])
    expect(variantMap.ok).toBe(true)
    expect(variantMap.requiredSites).toEqual(['alpha', 'beta'])
    expect(drillChecks.legacyCoreExtractionEvidence.status).toBe('complete')
    expect(drillChecks.legacyCryptoBoundaryEvidence.status).toBe('pass')
    expect(drillChecks.templateWorkerMapCoherence.status).toBe('complete')
    expect(drillChecks.forgetForwardConfig.status).toBe('complete')
    expect(drillChecks.templateSignatureRefMap.configured).toBe(true)
    expect(drillChecks.templateSignatureRefMap.requiredSites).toEqual(['alpha', 'beta'])
    expect(drillChecks.templateVariantMap.configured).toBe(true)
    expect(drillChecks.templateVariantMap.requiredSites).toEqual(['alpha', 'beta'])
    expect(matrix.counts.total).toBe(1)
    expect(pack.status).toBe('ready')
    expect(latest.bundleName).toBe('2026-04-11T12-00-00Z-abc')
    expect(readiness.status).toBe('ready')
    expect(manifest.release).toBe('2.0.0')
    expect(manifestValidation).toContain('valid release drill manifest')
    expect(drillCheck.ok).toBe(true)
    expect(ledger.overallStatus).toBe('ready')
    expect(ledgerMd).toContain('Release Evidence Ledger')
    expect(aoGateValidation).toContain('valid dependency gate')
  })
})
