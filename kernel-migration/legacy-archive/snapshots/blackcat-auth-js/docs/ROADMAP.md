# @blackcat/auth – Roadmap

## Stage 1 – Foundations (complete)
- ✅ `AuthClient` (password/client credentials grants, refresh, `/userinfo`, magic link, device code, sessions, event stream).
- ✅ Config loader + CLI workflows (`workflows:*`, `config:show`, `security:check`, `telemetry:tail`) a nové API příkazy (`login:password`, `token:client`, `token:refresh`, `userinfo`, `events:stream`, `sessions`).
- ✅ Telemetry reporter + Prometheus metrics, security/integration checks (`securityChecks`, `SecurityAuditor`) a mock fetcher pro offline scénáře.
- ✅ Vitest pokrytí (config/telemetry/CLI/client/security) + sample configs (`config/auth.example.json`, `config/auth.local.json`).

## Stage 2 – Browser integrations
- WebAuthn browser helpers (using `navigator.credentials`).
- Session watcher (auto-refresh + background polling) + React hooks (`useAuth`).
- CLI bundler (Vite plug-in) for environment injection.

## Stage 3 – Node/Edge SSR
- Middleware pro Next.js/Nuxt, cookie storage, token encryption.
- Device-code CLI utility (node binary) pro headless IoT provisioning.

## Stage 4 – Advanced Security
- Built-in rate-limit/backoff, telemetry (OpenTelemetry spans), encryption of stored tokens (delegates to `blackcat-crypto`).
- Offline queueing pro magic link / mobility.
