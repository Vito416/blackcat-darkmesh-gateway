# BlackCat Auth – Roadmap

## Stage 1 – Foundations ✅
- `config/example.auth.php` + `FoundationConfig` support `${env:...}` / `${file:...}` placeholders and `blackcat-config` profiles so deployments share the same secret sources.
- `AuthRuntime` + `UserStoreFactory` bootstrap a DB-backed identity store (`blackcat-database` `users` schema), CLI (`users:seed|users:list|security:check`) and `bin/auth-http --config=...`.
- Telemetry (`AuthTelemetry` + `TelemetryAuthHook`) exposes Prometheus metrics (`blackcat_auth_events_*`); `security:check` validates signing key, DB availability and telemetry wiring.
- CLI (`token:*`, `rbac:*`, `config:show`, `user:hash-password`) and HTTP server share the same runtime boot (seeding, DB provider, RBAC) and tests cover config loading + runtime seeding.

## Stage 2 – Flows & Extensibility ✅
- Password grant, refresh, client-credentials and PKCE helpers in `AuthManager` (`passwordGrant`, `clientCredentials`, `initiatePkce`, `exchangePkce`).
- `AuthEventHookInterface` + `LoggingAuthHook`, PKCE store (`PkceStoreInterface`, `InMemoryPkceStore`) and `ClientRegistry`.
- HTTP server (`bin/auth-http`) exposes `/authorize` + `/token` supporting all grant types.
- CLI extensions: `token:client`, `rbac:check`, `user:hash-password`, `token:issue` supports custom password input.
- ✅ Registration + email verification (`/register`, `/verify-email`, `/verify-email/resend`) on `blackcat-database` (`users`, `email_verifications`, `verify_events`) with deterministic lookup via ingress (no plaintext emails).
- ✅ Email delivery via `blackcat-mailing` (DB queue `notifications` + worker): no hardcoded SQL/views, only `blackcat-database` packages + views-library.
- ✅ Auth-level brute-force protection: `LoginLimiter` on DB tables (`login_attempts`, `register_events`) + ingress criteria (fail-open), using generated repos + Criteria (no raw SQL).
- ✅ Password reset flow (`/password-reset/request`, `/password-reset/confirm`) on `blackcat-database` (`password_resets`) + delivery via `blackcat-mailing` template `reset_password`.

## Stage 3 – Federation & SSO (in progress)
- ✅ OIDC discovery (`/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server`) + `/jwks.json` (HS512 `oct` JWK) derived from configured public base URL.
- ✅ Session service (`/session` endpoints, `SessionService`) + store: `memory`, `redis`, `database` (`blackcat-database` `sessions`).
- ✅ Device-code flow (`/device/code`, `/device/activate`, `/device/token`): DB-backed store (`blackcat-database` `device_codes`), no in-memory fallback.
- ✅ Magic link + WebAuthn (request/consume + register/auth endpoints): DB-backed stores (`magic_links`, `webauthn_credentials`, `webauthn_challenges`), no in-memory fallback.
- ✅ Magic-link mailing: template `magic_link` in `blackcat-mailing` + enqueue in `/magic-link/request` (dev-only return token controlled by config).
- ✅ Magic-link throttling (`/magic-link/request`) via `rate_limit_counters` + audit events into `auth_events` (non-enumerating; `429` + `Retry-After`).
- ✅ Throttling for `/password-reset/request` and `/verify-email/resend` via `rate_limit_counters` (non-enumerating; `429` + `Retry-After`).
- ✅ DB encryption bridge: `blackcat-database-crypto` ingress (`BlackCat\\Database\\Crypto\\IngressLocator`) for write-path automation + deterministic `criteria()` lookups (`users.email_hash`, rate-limit hash columns). Runtime config `crypto.keys_dir` is the single source of truth (no redirectable map paths).
- ✅ WebAuthn “prod-grade” hardening: challenge TTL in config, periodic cleanup and sign-counter enforcement (`sign_count`).
- ✅ Integration tests for DB stores (skipped unless `DB_DSN` is set) + CI gate (phpunit + phpstan + MySQL/Postgres matrix).
- Planned: session hardening (rolling IDs, remember-me), full WebAuthn attestation verification, and richer hooks for mailing (bounce/retry).
- Planned: outbound federation modules (SAML, WS-Fed, OAuth proxy) + inbound social logins (GitHub, Google) via hooks.
- ✅ FE-friendly SDK: repo `blackcat-auth-js` with `AuthClient` (password/device code/magic link/WebAuthn).

## Stage 4 – Advanced RBAC & ABAC
- Declarative policy language (YAML/JSON) with attributes (context, resource tags, risk levels), time-based and geo/region constraints. Compatible with `blackcat-core/RBAC.php`.
- Multi-tenant RBAC registry with shadow policies, audit log streaming to `blackcat-messaging`, cache invalidation via `blackcat-database-sync`.
- Edge enforcement cache and policy-as-code tooling (`auth policy:lint`, `policy:bundle`) + integration test harness.

## Stage 5 – Observability & Zero Trust
- Telemetry (Prometheus, OTLP traces), risk scoring/UEBA pipeline, adaptive auth (step-up, temporary lockouts) built on `StreamingAuthHook` + `/events/stream`.
- Service-mesh guards (mTLS cert pinning, token binding) + SPDY/gRPC interceptors for backend services.
- Extend `auth-http` with `/metrics`, `/events/stream` (SSE) and configurable webhooks; CLI audit `auth watch` for SecOps.

## Stage 6 – Identity Graph & Consent Hub (planned)
- Shared identity graph DB (user ↔ device ↔ org ↔ application) integrated with `blackcat-identity`.
- Consent/versioning API, data residency policies and automatic claim enrichment (locale, feature-flags).
- GraphQL/REST endpoints and frontend kit (React hooks) for profile/consent management, including offline sync via `blackcat-database-sync`.

(Repo is at Stage 2 ✅, progressing into Stage 3.)
