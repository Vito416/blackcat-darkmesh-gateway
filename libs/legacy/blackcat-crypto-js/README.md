# @blackcat/crypto (JS SDK + CLI)

JavaScript/TypeScript SDK sdílející envelope formát s hlavním repem `blackcat-crypto`. Stage 1 foundation přidává:

- jednotný loader `config/crypto.{local,example}.json` s vazbou na `blackcat-config` (env/file placeholders, PHP profily),
- CLI (`bin/crypto-js`) s příkazy `config:show`, `checks:run`, `workflows:list|run`, `slots:list|sign`, `telemetry:tail`, `coverage:print`,
- integrace na sousední repa (kontroluje existenci `blackcat-crypto`, `blackcat-config`, `blackcat-auth`, `blackcat-orchestrator`),
- telemetry + Prometheus export (`var/log/crypto-js.ndjson`, `var/metrics/crypto-js.prom`),
- vitest smoke testy pro loader, checky a CLI.

## Instalace

```bash
npm install @blackcat/crypto
```

## Konfigurace

1. Zkopíruj `config/crypto.example.json` do `config/crypto.local.json`.
2. Uprav `configProfile` tak, aby ukazoval do `blackcat-config/config/profiles.php` (např. environment `development`).
3. Doplnění secrets:
   - `keys.encryptionKeyFile` – cesta k AEAD klíči (Base64),
   - `keys.hmacSlots` – sloty `api`, `session`, `email` (může používat `${env:VAR}` / `${file:path}`).
4. Uprav integrace tak, aby odpovídaly lokálním cestám (`../blackcat-crypto/bin/crypto`, ...).

Loader automaticky expanduje `${env:VAR|default}` a `${file:path|fallback}` a načte env proměnné z `blackcat-config` profilů (pokud základna existuje).

## CLI

```bash
# načti config (výchozí config/crypto.local.json)
bin/crypto-js config:show

# běh security/integration checků
bin/crypto-js checks:run --json

# vypiš připravené workflow scénáře a spusť dry-run
bin/crypto-js workflows:list
bin/crypto-js workflows:run encrypt-pii

# podepiš payload pomocí slotu
bin/crypto-js slots:sign api "POST:/api/v1/tenants"

# synchronizuj HMAC sloty z manifestu
BLACKCAT_CRYPTO_MANIFEST=../blackcat-crypto-manifests/contexts/core.json \
  bin/crypto-js slots:sync --output=config/hmac.generated.json

# telemetry + Vault coverage snapshot
bin/crypto-js telemetry:tail --tail=20
bin/crypto-js coverage:print --table --top=5

Helper skript `scripts/run-coverage-report.sh` spustí billing/data/crypto-js coverage příkazy a pošle je do `blackcat-crypto/bin/crypto vault:coverage` (viz `docs/COVERAGE-WORKFLOW.md`).
```

Každý příkaz zapisuje telemetry event do `var/log/crypto-js.ndjson` a zároveň inkrementuje Prometheus counter `blackcat_crypto_cli_command_total` (výstup v `var/metrics/crypto-js.prom`). `telemetry:tail` vypíše poslední záznamy bez použití dalších nástrojů.

## Použití v kódu

```ts
import { LocalCipher, SlotRegistry } from '@blackcat/crypto';

const cipher = await LocalCipher.fromPassword('tenant-secret');
const envelope = await cipher.encrypt('pii', new TextEncoder().encode('123-45-6789'));

const slots = await SlotRegistry.fromConfig({ api: 'slot-secret' });
const signature = await slots.get('api').sign('payload');
```

## Roadmap

Viz `docs/ROADMAP.md` – Stage 1 hotovo (loader + CLI + telemetry/tests). Stage 2 přidá registry HMAC slotů synchronizované s `@blackcat/auth` a bezpečnější storage pro browser runtime.

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
