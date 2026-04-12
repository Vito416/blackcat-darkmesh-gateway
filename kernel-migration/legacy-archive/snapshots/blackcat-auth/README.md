# BlackCat Auth

Komplexní autentizační a autorizační SDK pro platformu BlackCat. Cílem je nabídnout centrální logiku, aby frontend/edge služby nemusely vymýšlet vlastní tokeny, refresh mechanismy ani RBAC – vše jde přes `AuthManager` a přidružené služby.

## Klíčové vlastnosti

- **Více typů tokenů** – krátkodobé přístupové tokeny (JWT kompatibilní), refresh tokeny, servisní tokeny pro backend-backend komunikaci.
- **RBAC jádro** – `PolicyDecisionPoint` + `RoleRegistry` podporují role, skupiny i dynamické politiky (ABAC hooky).
- **Integrace s Crypto** – podpisy tokenů lze delegovat na `blackcat-crypto` (AEAD/HMAC). Pokud crypto není dostupné, fallback na lokální klíče.
- **IdentityProvider rozhraní** – snadno napojíš databázi, LDAP, OAuth brokera atd.
- **HTTP/CLI rozšíření** – vestavěný mini server (`auth-http`) pro testování login/refresh/PKCE/client-creds a CLI (`bin/auth`) pro vydávání tokenů, správu rolí, audit.
- **Password & email hashing** – `PasswordHasher` s pepper providerem a `DatabaseUserProvider` s pluggable EmailHasher (KeyManager/crypto friendly).
- **Login limiter** – ochrana proti brute-force (tabulky `login_attempts` + `register_events` z `blackcat-database`), deterministické HMAC přes crypto ingress; HTTP vrací `429` + `Retry-After`.
- **Front-end friendly** – hotové middleware/guards pro REST/GraphQL, rozhraní pro PKCE (S256/PLAIN), device-code a service-to-service flows.
- **Audit hooky & PKCE store** – `AuthEventHookInterface` umožňuje logovat každou autentizaci, `PkceStoreInterface` drží authorization codes s nastavitelným TTL.
- **OIDC discovery** – `/.well-known/openid-configuration` a `/jwks.json` staví metadata/JWKS automaticky z konfigurace (HS512 `oct` klíč, `jwks_uri`, granty…).
- **Device-code & session management** – `/device/*` endpoints s pending store a `/session` API pro rolling sessions (Database/Redis store přes konfiguraci).

## Struktura

```
blackcat-auth/
├── src/
│   ├── AuthManager.php          # hlavní fasáda
│   ├── Config/                  # AuthConfig + env loader
│   ├── Token/                   # token service, JWT/JWE podpisy
│   ├── Rbac/                    # role, policy decision point
│   ├── Identity/                # IdentityProvider rozhraní
│   ├── Http/                    # jednoduchý HTTP server + middleware
│   ├── CLI/                     # příkazy pro správu
│   ├── Middleware/              # PSR-15 guardy
│   └── Support/                 # pomocné třídy (Clock, Encoder…)
├── docs/ROADMAP.md
├── README.md
├── composer.json
├── bin/auth
└── tests/
```

## Rychlý start

```bash
composer install
php bin/auth help
php bin/auth-http --port=8082
```

## Konfigurace & Foundation CLI (Stage 1)

- `config/example.auth.php` je kanonický vstup. Podporuje `${env:FOO}` / `${file:/path}` placeholdery a může načítat sdílené profily z `blackcat-config/config/profiles.php`. Doporučený způsob spuštění CLI je tedy vždy přes konfig:

```bash
export BLACKCAT_AUTH_SIGNING_KEY=$(openssl rand -base64 32)
export BLACKCAT_AUTH_PEPPER=$(openssl rand -base64 32)
php bin/auth config/example.auth.php config:show
```

- **Seed & správa uživatelů** – Stage 1 CLI přidává `users:seed`, `users:list`, `user:hash-password` a `token:*` příkazy, které používají databázový store (MySQL/Postgres) přes `BlackCat\Core\Database` + `blackcat-database` a crypto ingress (deterministické `email_hash` lookupy). Stačí přizpůsobit `user_store` sekci v konfigu:

```bash
php bin/auth config/example.auth.php users:seed --force
php bin/auth config/example.auth.php users:list
php bin/auth config/example.auth.php token:issue --user=admin@example.com --password=secret
php bin/auth config/example.auth.php security:check
```

- **Telemetry & bezpečnost** – `telemetry.prom` soubor (viz `telemetry.prometheus_file`) se aktualizuje přes `TelemetryAuthHook`. `security:check` ověřuje délku signing key, dostupnost DB a zda je nastavena telemetry/pepper. `bin/auth-http --config=...` používá stejné konfigurační hodnoty + `UserStoreFactory` pro HTTP server, takže CLI/HTTP sdílí jednu konfiguraci.

- **Integrace na ostatní repa** – config podporuje `config_profile` (čte `blackcat-config`), `user_store` používá `blackcat-database` schéma (`users` tabulka) a signing key/pepper se běžně generují/uchovávají v `blackcat-crypto`. Stage 1 tak splňuje checklist: config loader, CLI vstupy (`config:show`, `users:list`, `token:*`), telemetry, security checks + docs/tests.

V aplikaci:

```php
use BlackCat\Auth\AuthManager;
use BlackCat\Auth\Config\AuthConfig;
use BlackCat\Auth\Identity\ArrayUserProvider;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Auth\Password\EnvPepperProvider;

$config = AuthConfig::fromEnv();
$provider = new ArrayUserProvider([
    ['id' => '1', 'email' => 'admin@example.com', 'password' => 'secret', 'roles' => ['admin']],
]);
$hasher = new PasswordHasher(new EnvPepperProvider());
$auth = AuthManager::boot($config, $provider);

$login = $auth->issueTokens('admin@example.com', 'secret');
$claims = $auth->verifyAccessToken($login->accessToken);
$auth->enforce('admin', $claims); // RBAC check
```

## Testy

```
composer test
```

## CLI

```
php bin/auth config/example.auth.php config:show
php bin/auth config/example.auth.php users:seed --force
php bin/auth config/example.auth.php users:list
php bin/auth config/example.auth.php token:issue --user=admin@example.com --password=secret
php bin/auth config/example.auth.php token:client --client=service-api --secret=supersecret
php bin/auth config/example.auth.php rbac:check --role=admin --claims='{"roles":["admin"]}'
php bin/auth config/example.auth.php user:hash-password --password="MyStrongPass"
```

## HTTP server

```
php bin/auth-http --config=config/example.auth.php --port=8082
```

Endpointy:

| Endpoint | Popis |
| --- | --- |
| `POST /login` | Password grant (`username`, `password`). |
| `POST /register` | Registrace uživatele (`email|username`, `password`) + vydání e-mail verifikačního tokenu. |
| `POST /verify-email` | Verifikace e-mailu (`token`) + aktivace uživatele + vydání token pair. |
| `POST /verify-email/resend` | Znovu vystaví verifikační token (`email|username`) – non-enumerating; při throttlingu vrací `429` + `Retry-After`. |
| `POST /password-reset/request` | Vystaví reset token (`email|username`) – non-enumerating; při throttlingu vrací `429` + `Retry-After`. |
| `POST /password-reset/confirm` | Spotřebuje reset token (`token`, `new_password`) a nastaví nové heslo. |
| `POST /token` | OAuth-like token endpoint (`grant_type=password|refresh_token|client_credentials|authorization_code`). |
| `POST /authorize` | PKCE init (`client_id`, `username`, `password`, `code_challenge`, `code_challenge_method`). |
| `POST /introspect` | Ověření access tokenu / refresh tokenu. |
| `GET /healthz` | Základní health probe. |
| `GET /.well-known/openid-configuration` | OIDC discovery dokument (issuer, endpoints, granty). |
| `GET /jwks.json` | JWKS se seznamem klíčů (aktuálně `oct` pro HS512). |
| `GET /userinfo` | Vrátí claims aktuálního uživatele (vyžaduje Bearer token). |
| `POST /session` | Issuance session ID (Bearer token + volitelné context metadata). |
| `GET /session` | Výpis aktivních sessions aktuální identity. |
| `DELETE /session/{id}` | Zneplatní konkrétní session (pokud patří aktuálnímu subjektu). |
| `POST /device/code` | Vygeneruje device & user code pro offline zařízení. |
| `POST /device/activate` | Uživatelská aktivace – zadá `user_code` + přihlašovací údaje. |
| `POST /device/token` | Zařízení polluje, dokud nedostane access/refresh tokeny. |
| `POST /magic-link/request` | Vystaví magic-link pro zadaný e-mail (non-enumerating); pokud je nakonfigurován mailing, zařadí e-mail do DB fronty. Dev-only může vrátit token/link (`BLACKCAT_AUTH_DEV_RETURN_MAGICLINK_TOKEN=1`). Při throttlingu vrací `429` + `Retry-After`. |
| `POST /magic-link/consume` | Spotřebuje magic-link token a vrací token pair. |
| `POST /webauthn/register/start` | (Bearer) Vrátí challenge pro registraci bezpečnostního klíče. |
| `POST /webauthn/register/finish` | (Bearer) Uloží credential. |
| `POST /webauthn/authenticate/start` | Spouští přihlášení – vrací challenge a allowed credential IDs. |
| `POST /webauthn/authenticate/finish` | Dokončí WebAuthn přihlášení, vrací token pair (volitelně `sign_count` pro anti-replay). |
| `GET /events/stream` | Vrací poslední auth události (`events` + `last_id`), vhodné pro SSE polling. |

## Registrace + e-mail verifikace

- `BLACKCAT_AUTH_REQUIRE_EMAIL_VERIFICATION=1` (default) udržuje nové účty `users.is_active=0` do ověření.
- `BLACKCAT_AUTH_DEV_RETURN_VERIFICATION_TOKEN=1` vrací `verification_token` v odpovědi (dev-only).
- `BLACKCAT_AUTH_EMAIL_VERIFICATION_LINK_TEMPLATE="https://app.example.com/verify?token={token}"` přidá `verification_link`.
- V produkci se verifikační e-mail posílá přes DB frontu `notifications` (viz `blackcat-mailing`) – auth pouze vloží notifikaci, worker ji odešle přes SMTP.
- Pro config-file režim je kanonické nastavení v `blackcat-auth/config/example.auth.php` (sekce `mailing` + `auth.registration`).
- Throttling pro `/verify-email/resend` nastav přes `BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_*` (vrací `429` + `Retry-After`).

```bash
# 1) Register (dev odpověď může obsahovat verification_token + verification_link)
curl -X POST http://localhost:8082/register -d '{"email":"user@example.com","password":"secret"}'

# 2) Verify email (spotřebuje token a vrací access/refresh tokeny)
curl -X POST http://localhost:8082/verify-email -d '{"token":"<selector>.<validator>"}'
```

## Password reset

- `BLACKCAT_AUTH_PASSWORD_RESET_TTL=3600` nastaví TTL reset tokenu (default 3600).
- `BLACKCAT_AUTH_PASSWORD_RESET_LINK_TEMPLATE="https://app.example.com/reset-password?token={token}"` přidá `reset_link`.
- `BLACKCAT_AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN=1` vrací `reset_token` v odpovědi (dev-only).
- Pokud je nakonfigurován `blackcat-mailing`, `auth-http` zařadí e-mail do DB fronty `notifications` (template `reset_password`).
- Throttling pro `/password-reset/request` nastav přes `BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_*` (vrací `429` + `Retry-After`).

```bash
# 1) Request reset (always returns ok; dev může vrátit reset_token + reset_link)
curl -X POST http://localhost:8082/password-reset/request -d '{"email":"user@example.com"}'

# 2) Confirm reset (spotřebuje token a nastaví nové heslo)
curl -X POST http://localhost:8082/password-reset/confirm -d '{"token":"<selector>.<validator>","new_password":"newSecret"}'
```

## PKCE příklad

```php
$verifier = bin2hex(random_bytes(32));
$challenge = \BlackCat\Auth\Pkce\PkceHelper::challengeFromVerifier($verifier);
$code = $auth->initiatePkce('service-api', 'admin@example.com', 'secret', $challenge);
$tokens = $auth->exchangePkce('service-api', $code, $verifier);
```

## Session service

```php
use BlackCat\Auth\Session\SessionService;
use BlackCat\Auth\Session\InMemorySessionStore;

$sessions = new SessionService(new InMemorySessionStore(), 60 * 60 * 24 * 14); // 14 dní
$auth = $auth->withSessionService($sessions);
$pair = $auth->issueTokens('admin@example.com', 'secret');
$session = $auth->issueSession($auth->verifyAccessToken($pair->accessToken), ['ip' => '127.0.0.1']);
```

Pozn.: `BlackCat\\Auth\\Session\\*` jsou BC aliasy na `blackcat-sessions` (`BlackCat\\Sessions\\*`).

Pro produkci nastav `BLACKCAT_AUTH_SESSION_TTL` a `BLACKCAT_AUTH_SESSION_STORE` (např. `{"type":"database"}` nebo `{"type":"redis","uri":"tcp://redis:6379","prefix":"auth:sessions"}`) – v režimu `database` se používá `blackcat-database` tabulka `sessions`.

## Device code flow

```bash
# 1) Zařízení (bez klávesnice) požádá o kód
curl -X POST http://localhost:8082/device/code -d '{"client_id":"device-client","scope":"openid"}'

# 2) Zobrazí se user_code a verification_uri -> uživatel otevře /device/activate
# 3) Aktivace
curl -X POST http://localhost:8082/device/activate -d '{"user_code":"ABCD1234","username":"demo@example.com","password":"secret"}'

# 4) Zařízení polluje
curl -X POST http://localhost:8082/device/token -d '{"device_code":"<device_code>"}'
```

## Magic link

```bash
# 1) Požádej o magic link
curl -X POST http://localhost:8082/magic-link/request \
     -H "Content-Type: application/json" \
     -d '{"email":"demo@example.com","redirect":"/dashboard"}'

# 2) V ostrém prostředí odejde e-mail (template `magic_link` přes blackcat-mailing); v dev režimu může být v odpovědi `token` a `link`

# 3) Uživatelský klient odešle token
curl -X POST http://localhost:8082/magic-link/consume \
     -H "Content-Type: application/json" \
     -d '{"token":"<token>"}'
```

Magic link TTL nastav `BLACKCAT_AUTH_MAGICLINK_TTL` (sekundy) a `BLACKCAT_AUTH_MAGICLINK_URL` (frontend stránka, která token spotřebuje). Pro dev/test můžeš zapnout `BLACKCAT_AUTH_DEV_RETURN_MAGICLINK_TOKEN=1` (vrátí `token`/`link` v odpovědi); v produkci se posílá e-mail přes `blackcat-mailing` (DB queue `notifications`, template `magic_link`). Throttling nastav přes `BLACKCAT_AUTH_MAGICLINK_THROTTLE_*` (viz níže).

## Event stream / Observability

`auth-http` udržuje kruhový buffer auditních událostí (výchozí 200 položek, nastav `BLACKCAT_AUTH_EVENTS_BUFFER`). Endpoint `/events/stream?last_id=123` vrací JSON:

```json
{
  "last_id": 42,
  "events": [
    {"id": 41, "event": "password_grant", "payload": {"username": "demo@example.com","result":"success"}, "timestamp": 1710000000}
  ]
}
```

Pro SSE-like chování klient periodicky volá endpoint s `last_id` a doručuje jen nové položky. Velikost bufferu nastav `BLACKCAT_AUTH_EVENTS_BUFFER`.

Audity snadno přepošleš do observability vrstvy:

```php
use BlackCat\Auth\Support\StreamingAuthHook;
use BlackCat\Observability\ObservabilityManager;

$obs = ObservabilityManager::boot();
$hook = new StreamingAuthHook(fn($event, $payload) => $obs->events()->publish('auth.' . $event, $payload));
$auth = AuthManager::boot($config, $provider, logger: null, hook: $hook);
```

## WebAuthn (Passkeys)

```bash
# Registrace (uživatel musí mít Bearer token)
curl -H "Authorization: Bearer <token>" -X POST http://localhost:8082/webauthn/register/start
curl -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"challenge":"...","credential_id":"cred-1","public_key":"base64public"}' \
     http://localhost:8082/webauthn/register/finish

# Přihlášení
curl -X POST http://localhost:8082/webauthn/authenticate/start -d '{"email":"demo@example.com"}'
curl -X POST http://localhost:8082/webauthn/authenticate/finish \
     -H "Content-Type: application/json" \
     -d '{"email":"demo@example.com","challenge":"...","credential_id":"cred-1"}'
```

Pro aktivaci nastav `BLACKCAT_AUTH_WEBAUTHN_RP_ID` (např. `auth.example.com`) a `BLACKCAT_AUTH_WEBAUTHN_RP_NAME` (zobrazované jméno). Implementace zatím uchovává credentialy v paměti – pro produkci je potřeba vlastní store (Redis/DB).

## Audit hooky

```php
use BlackCat\Auth\Support\LoggingAuthHook;
$logger = new \Monolog\Logger('auth');
$auth = AuthManager::boot($config, $provider, $logger, null, new LoggingAuthHook($logger));
```

Konfigurační proměnná `BLACKCAT_AUTH_EVENT_WEBHOOKS` (JSON list URL) umožňuje zároveň odesílat události na externí webhooks (POST JSON).

## Konfigurace (env)

- `BLACKCAT_AUTH_ROLES` – JSON definice rolí/permissions.
- `BLACKCAT_AUTH_CLIENTS` – JSON map (`client_id` => `{secret,roles,scopes,access_ttl,pkce}`).
- `BLACKCAT_AUTH_PKCE_TTL` – TTL pro authorization codes (sekundy, default 300).
- `BLACKCAT_AUTH_USERS` – JSON fallback uživatelů pro `auth-http` (pokud nepoužívá DB).
- `BLACKCAT_AUTH_DB_DSN` (+ `_USER`, `_PASS`) – DSN pro databázový user store (MySQL/Postgres, `blackcat-database` schéma `users`).
- Runtime config: `crypto.keys_dir` (+ volitelně `crypto.manifest`) – konfigurace crypto ingress pro deterministické `email_hash` lookupy (single source of truth pro mapy je `packages/*/schema/encryption-map.json` v `blackcat-database`).
- `BLACKCAT_AUTH_HTTP_PORT` – implicitní port HTTP serveru.
- `BLACKCAT_AUTH_BASE_URL` – veřejná URL použitá pro OIDC discovery endpoints (`https://auth.example.com`).
- `BLACKCAT_AUTH_SESSION_TTL` – pokud je > 0, aktivuje session service (`/session` endpointy) s daným TTL v sekundách.
- `BLACKCAT_AUTH_SESSION_STORE` – JSON konfigurace session storage (`{"type":"database"}` nebo `{"type":"redis","uri":"tcp://redis:6379","prefix":"myapp:sessions"}`).
- `BLACKCAT_AUTH_PASSWORD_RESET_TTL` – TTL reset tokenů (sekundy; default 3600).
- `BLACKCAT_AUTH_PASSWORD_RESET_LINK_TEMPLATE` – link template pro FE reset URL (`.../reset-password?token={token}`).
- `BLACKCAT_AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN` – dev-only: vrací `reset_token` + `reset_link` v `/password-reset/request`.
- `BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_WINDOW_SEC` – délka window (sekundy; default 300).
- `BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_IP` – limit pro `/password-reset/request` per-IP (default 50).
- `BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_EMAIL` – limit pro `/password-reset/request` per-email (default 3).
- `BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_WINDOW_SEC` – délka window (sekundy; default 300).
- `BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_IP` – limit pro `/verify-email/resend` per-IP (default 50).
- `BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_EMAIL` – limit pro `/verify-email/resend` per-email (default 3).
- `BLACKCAT_AUTH_MAGICLINK_TTL` – TTL pro magic link tokeny (sekundy).
- `BLACKCAT_AUTH_MAGICLINK_URL` – veřejná URL kam se má magic link směrovat (např. `https://app.example.com/magic-login`).
- `BLACKCAT_AUTH_DEV_RETURN_MAGICLINK_TOKEN` – dev-only: vrací `token` + `link` v `/magic-link/request`.
- `BLACKCAT_AUTH_MAGICLINK_THROTTLE_WINDOW_SEC` – délka window (sekundy; default 300).
- `BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_IP` – limit pro `/magic-link/request` per-IP (default 100).
- `BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_EMAIL` – limit pro `/magic-link/request` per-email (default 5).
- `BLACKCAT_AUTH_WEBAUTHN_RP_ID` / `BLACKCAT_AUTH_WEBAUTHN_RP_NAME` – aktivuje WebAuthn endpoints (RP ID/Name).
- `BLACKCAT_AUTH_WEBAUTHN_CHALLENGE_TTL` – TTL pro WebAuthn challenge (sekundy; default 600).
- `BLACKCAT_AUTH_EVENTS_BUFFER` – velikost kruhového bufferu pro `/events/stream` (default 200).
- `BLACKCAT_AUTH_EVENT_WEBHOOKS` – JSON seznam webhook URL, kam se posílají audit eventy.

## Další kroky

- Roadmapa je v `docs/ROADMAP.md`.
- `auth-http` poslouží jako referenční server pro testování grantů; `bin/auth` obsahuje i audit/telemetrické helpery (viz nové příkazy).

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
