import { Hono } from 'hono'

type Env = {
  MAILER_AUTH_TOKEN?: string
  MAIL_PROVIDER?: string
  MAIL_FROM?: string
}

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'site-mailer-worker',
    provider: c.env?.MAIL_PROVIDER || 'unset'
  })
)

app.post('/mail/send', async (c) => {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || token !== c.env?.MAILER_AUTH_TOKEN) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'invalid_payload' }, 400)
  }

  // Scaffold: wire provider integration here (SMTP/API) in next batch.
  return c.json({ ok: true, accepted: true, provider: c.env?.MAIL_PROVIDER || 'unset' }, 202)
})

export default app
