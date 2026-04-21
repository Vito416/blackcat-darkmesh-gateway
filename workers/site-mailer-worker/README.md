# Site Mailer Worker (scaffold)

Optional per-site worker for mail sends and queue orchestration.

## Scope

- Receives signed internal send requests from trusted site flow.
- Uses per-site provider secrets (SMTP/API keys) from Worker secrets.
- Emits delivery telemetry without storing long-term PIP.

## Security constraints

- Must require auth token or signature verification for every send endpoint.
- Never expose provider secrets.
- Do not persist raw recipient emails longer than operation window.

## Quick start

1. `cp wrangler.toml.example wrangler.toml`
2. Set provider secrets via `wrangler secret put ...`.
3. `npm install`
4. `npm run dev`
