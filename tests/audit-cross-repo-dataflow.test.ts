import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { assessCrossRepoDataflow, runCli } from '../scripts/audit-cross-repo-dataflow.js'

const CONTRACT_JSON = JSON.stringify(
  {
    allowedActions: [
      {
        name: 'public.resolve-route',
        method: 'POST',
        path: '/api/public/resolve-route',
        auth: { requiredRole: 'public' },
      },
      {
        name: 'public.get-page',
        method: 'POST',
        path: '/api/public/page',
        auth: { requiredRole: 'public' },
      },
      {
        name: 'checkout.create-order',
        method: 'POST',
        path: '/api/checkout/order',
        auth: { requiredRole: 'shop_admin' },
      },
      {
        name: 'checkout.create-payment-intent',
        method: 'POST',
        path: '/api/checkout/payment-intent',
        auth: { requiredRole: 'shop_admin' },
      },
    ],
  },
  null,
  2,
)

function writeFile(root: string, relPath: string, text: string) {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function buildFixture(options: { roleSigned: boolean; gatewayCallerRole: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'bc-cross-flow-'))

  writeFile(root, 'blackcat-darkmesh-gateway/config/template-backend-contract.json', CONTRACT_JSON)
  writeFile(
    root,
    'blackcat-darkmesh-gateway/src/templateApi.ts',
    options.gatewayCallerRole
      ? 'const writeEnvelope = { role: input.role }\n'
      : 'const writeEnvelope = { role: resolvedRole }\n',
  )
  writeFile(
    root,
    'blackcat-darkmesh-gateway/src/handler.ts',
    'const x = process.env.GATEWAY_SITE_ID_BY_HOST_MAP\nconst y = "site_id_host_mismatch"\n',
  )

  writeFile(
    root,
    'blackcat-darkmesh-ao/scripts/http/public_api_server.mjs',
    "const routes = ['/api/public/resolve-route','/api/public/page','/healthz']\n",
  )
  writeFile(
    root,
    'blackcat-darkmesh-write/scripts/http/checkout_api_server.mjs',
    "const routes = ['/api/checkout/order','/api/checkout/payment-intent','/healthz']\n",
  )

  const workerRolePart = options.roleSigned ? 'cmd.role || "",\n' : ''
  const workerAllowedRolePart = options.roleSigned ? "'role', 'Role'," : ''
  writeFile(
    root,
    'blackcat-darkmesh-ao/worker/src/index.ts',
    [
      "function canonicalDetachedMessage(cmd: any): string {",
      '  const parts = [',
      '    cmd.action || cmd.Action || "",',
      '    cmd.tenant || cmd.Tenant || "",',
      '    cmd.actor || cmd.Actor || "",',
      '    cmd.timestamp || cmd.ts || "",',
      '    cmd.nonce || cmd.Nonce || "",',
      workerRolePart,
      '    stableStringify(cmd.payload || cmd.Payload || {}),',
      '    cmd.requestId || cmd["Request-Id"] || ""',
      '  ]',
      '  return parts.join("|")',
      '}',
      `const allowedKeys = new Set(['action','Action','tenant','Tenant','actor','Actor','timestamp','ts','nonce','Nonce',${workerAllowedRolePart}'payload','Payload','requestId','Request-Id'])`,
    ].join('\n'),
  )

  const writeRolePart = options.roleSigned ? '    pick(msg.role, msg["Actor-Role"]),\n' : ''
  writeFile(
    root,
    'blackcat-darkmesh-write/ao/shared/auth.lua',
    [
      'local function canonical_detached_message(msg)',
      '  local parts = {',
      '    msg.action or msg.Action or "",',
      '    pick(msg.tenant, msg.Tenant, msg["Tenant-Id"]),',
      '    pick(msg.actor, msg.Actor),',
      '    pick(msg.ts, msg.timestamp, msg["X-Timestamp"]),',
      '    pick(msg.nonce, msg.Nonce, msg["X-Nonce"]),',
      writeRolePart,
      '    canonical_payload(msg),',
      '    msg.requestId or msg["Request-Id"] or "",',
      '  }',
      '  return table.concat(parts, "|")',
      'end',
    ].join('\n'),
  )

  const signRolePart = options.roleSigned ? '    cmd.role || cmd["Actor-Role"] || "",\n' : ''
  writeFile(
    root,
    'blackcat-darkmesh-write/scripts/sign-write.js',
    [
      'function canonicalDetachedMessage(cmd) {',
      '  return [',
      '    cmd.action || cmd.Action || "",',
      '    cmd.tenant || cmd.Tenant || "",',
      '    cmd.actor || cmd.Actor || "",',
      '    cmd.ts || cmd.timestamp || cmd["X-Timestamp"] || "",',
      '    cmd.nonce || cmd.Nonce || cmd["X-Nonce"] || "",',
      signRolePart,
      '    canonicalPayload(cmd.payload || cmd.Payload || {}),',
      '    cmd.requestId || cmd["Request-Id"] || "",',
      '  ].join("|");',
      '}',
    ].join('\n'),
  )

  return root
}

describe('audit-cross-repo-dataflow.js', () => {
  it('flags unsigned role and caller-supplied role as blockers', () => {
    const root = buildFixture({ roleSigned: false, gatewayCallerRole: true })
    try {
      const summary = assessCrossRepoDataflow({ workspaceRoot: root })
      const codes = summary.blockers.map((item) => item.code)
      expect(codes).toContain('unsigned_role_field')
      expect(codes).toContain('gateway_role_from_caller')

      const cli = runCli(['--workspace-root', root, '--strict', '--json'])
      expect(cli.exitCode).toBe(3)
      const parsed = JSON.parse(cli.stdout)
      expect(parsed.blockerCount).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes blockers when role is signed and gateway does not trust caller role', () => {
    const root = buildFixture({ roleSigned: true, gatewayCallerRole: false })
    try {
      const summary = assessCrossRepoDataflow({ workspaceRoot: root })
      expect(summary.blockerCount).toBe(0)
      expect(summary.diagnostics.roleSigned).toBe(true)

      const cli = runCli(['--workspace-root', root, '--strict', '--json'])
      expect(cli.exitCode).toBe(0)
      const parsed = JSON.parse(cli.stdout)
      expect(parsed.blockerCount).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
