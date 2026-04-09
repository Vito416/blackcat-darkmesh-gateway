# @blackcat/auth (TypeScript SDK)

Lehký klient pro `blackcat-auth` HTTP API. Místo ad-hoc `fetch()` volání nabízí pohodlné třídy a helpery pro:

- password grant (`/login` / `/token`)
- refresh / client credentials
- device-code flow (`/device/*`)
- magic-link request/consume
- WebAuthn registraci/přihlášení
- session/misc endpoints (`/session`, `/userinfo`, `/events/stream`)

## Instalace

```bash
npm install @blackcat/auth
```

## Použití

```ts
import { AuthClient } from '@blackcat/auth';

const auth = new AuthClient({ baseUrl: 'https://auth.example.com' });
const pair = await auth.passwordGrant('user@example.com', 'secret');
const userinfo = await auth.userinfo(pair.accessToken);

const magicLink = await auth.requestMagicLink('user@example.com');
await auth.consumeMagicLink(magicLink.token);
```

Podrobnosti v `docs/ROADMAP.md`. SDK je navrženo tak, aby automaticky pracovalo s odpověďmi `blackcat-auth` (token pairs, session list). Každá metoda vrací typed promisy a lze ji snadno rozšířit.

## Stage 1 foundation

Stage 1 znamená, že SDK umí fungovat samostatně a je propojeno s centrálními repozitáři:

- konfigurační loader (`config/auth.example.json`) navazuje na `blackcat-config` profily a sdílí integrace (`blackcat-auth`, `blackcat-database`, `blackcat-orchestrator`),
- CLI (`bin/auth-sdk`) s příkazy `config:*`, `security:check`, `workflows:*`, `login:password`, `token:client`, `events:stream`, `sessions`, atd.,
- telemetrie zapisuje NDJSON záznamy do `var/log` a Prometheus metriky do `var/metrics` (připravené pro `blackcat-observability`),
- `securityChecks` a `workflows` provádějí integrační ověření proti `blackcat-auth` a ověřují, že config respektuje povinné integrace/šifrovací kontroly,
- testy (`vitest`) pokrývají loader, CLI, telemetry i security flow.

## CLI nástroje

CLI používá mock fetcher, takže základní příkazy fungují i offline; přepněte na produkční API přes `--live`.

```bash
# Konfigurace a kontroly
node bin/auth-sdk config:show --config=./config/auth.local.json --json
node bin/auth-sdk security:check --no-probe

# Auth scénáře
node bin/auth-sdk login:password demo@example.com secret
node bin/auth-sdk token:client "openid,email"
node bin/auth-sdk userinfo "$(node bin/auth-sdk login:password demo secret --json | jq -r .accessToken)"

# Workflows a telemetrie
node bin/auth-sdk workflows:list
node bin/auth-sdk workflows:run password-demo --execute --live
node bin/auth-sdk telemetry:tail 5
```

CLI sdílí konfiguraci přes `BLACKCAT_AUTH_CONFIG` nebo `--config=<path>` a loguje do `var/log/auth-cli.ndjson`.

## CLI & config loader

Stage 1 přidal CLI (`bin/auth-sdk`), který čte `config/auth.local.json` (nebo `auth.example.json`) a poskytuje standardizované scénáře.

```bash
# zobrazit konfiguraci, která se reálně načetla
node ./bin/auth-sdk config:show --json

# spustit smoke testy – výchozí režim je dry-run, použij --live pro skutečné volání API
node ./bin/auth-sdk workflows:run password-demo

# bezpečnostní a integrační kontroly
npm run build && node ./bin/auth-sdk security:check --no-probe
```

Konfigurace podporuje placeholdery `${env:VAR|fallback}` nebo `${file:path}` a integruje se s `blackcat-config` profily (viz `config/auth.example.json`). Telemetrie CLI se zapisuje do `var/log/auth-sdk.ndjson` a z CLI je možné ji procházet příkazem `telemetry:tail`.

## Telemetrie + bezpečnost

SDK obsahuje `TelemetryReporter`, který se automaticky používá v `AuthClient` i CLI. Události je možné směrovat do souboru nebo vlastního writeru a následně kontrolovat přes CLI (`telemetry:tail --json`). Součástí Stage 1 je také `security:check`, který hlídá:

- použití HTTPS u `baseUrl`,
- přítomnost `clientSecret` a rozumných timeoutů,
- dostupnost konfigurovaných integrací (`blackcat-auth`, `blackcat-orchestrator`, …),
- možnost zapisovat telemetry/metrics soubory,
- volitelný health probe na `/health/auth`.

Knihovna exportuje i `SecurityAuditor`, takže stejné kontroly lze spouštět přímo z aplikace (`import { SecurityAuditor } from '@blackcat/auth'`).

## Testování

Vitest scénáře pokrývají config loader, telemetrii, CLI a základní chování klienta. Spustíš je příkazem:

```bash
npm run test
```

Pro kompletní Stage 1 “verify” pipeline lze použít `npm run build && npm run test` a následně `node ./bin/auth-sdk security:check`.

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
