import { Hono } from 'hono'

type Env = {
  HB_TARGETS?: string
  AO_SITE_RESOLVE_URL?: string
  STRICT_SITE_RESOLVE?: string
}

const app = new Hono<{ Bindings: Env }>()

function parseTargets(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function selectTarget(targets: string[], host: string): string | null {
  if (targets.length === 0) return null
  let hash = 0
  for (let i = 0; i < host.length; i += 1) {
    hash = (hash * 31 + host.charCodeAt(i)) >>> 0
  }
  return targets[hash % targets.length] || null
}

async function resolveHost(bindings: Env, host: string): Promise<boolean> {
  const resolveUrl = bindings.AO_SITE_RESOLVE_URL?.trim()
  if (!resolveUrl) return bindings.STRICT_SITE_RESOLVE !== '1'

  const response = await fetch(resolveUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host })
  })

  if (!response.ok) return false
  const payload = (await response.json().catch(() => ({}))) as { status?: string; ok?: boolean }
  return Boolean(payload.ok || payload.status === 'ok' || payload.status === 'resolved')
}

app.get('/health', (c) => c.json({ ok: true, service: 'edge-routing-worker' }))

app.all('*', async (c) => {
  const host = c.req.header('host')?.trim().toLowerCase()
  if (!host) return c.json({ ok: false, error: 'missing_host' }, 400)

  const allowed = await resolveHost(c.env, host)
  if (!allowed) return c.json({ ok: false, error: 'host_not_resolved' }, 404)

  const targets = parseTargets(c.env.HB_TARGETS)
  const target = selectTarget(targets, host)
  if (!target) return c.json({ ok: false, error: 'no_upstream_targets' }, 503)

  const url = new URL(c.req.url)
  const upstream = new URL(url.pathname + url.search, target)

  // Temporary scaffold behavior: 307 redirect to selected upstream.
  return c.redirect(upstream.toString(), 307)
})

export default app
