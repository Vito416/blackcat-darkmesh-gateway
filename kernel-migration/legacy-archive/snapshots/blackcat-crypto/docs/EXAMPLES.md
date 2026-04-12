# BlackCat Crypto – Quick Examples

## Bootstrap (PHP)
```php
use BlackCat\Crypto\Bootstrap\PlatformBootstrap;

$crypto = PlatformBootstrap::boot(); // uses blackcat-config runtime config (crypto.keys_dir, crypto.manifest)
```

## Encrypt/Decrypt (context envelope)
```php
$envelope = $crypto->encryptContext('users.pii', 'hello');
$plaintext = $crypto->decryptContext('users.pii', $envelope->encode());
```

## Encrypt/Decrypt (local-only payload)
```php
$payload = $crypto->encryptLocal('users.pii', 'hello');
$plaintext = $crypto->decryptLocal('users.pii', $payload);
```

## HMAC (rotation-safe)
```php
// Prefer storing both signature + keyId (DB column *_key_version).
$out = $crypto->hmacWithKeyId('core.hmac.email', $message);
$signature = $out['signature']; // 32-byte binary
$keyId = $out['keyId'];         // e.g. email_hash_key_v3.key

// Later:
$ok = $crypto->verifyHmacWithKeyId('core.hmac.email', $message, $signature, $keyId);

// If you need to lookup without knowing keyId, compute candidates and query via IN (...):
$candidates = $crypto->hmacCandidates('core.hmac.email', $message);
// SELECT ... WHERE email_hmac IN (:sig1, :sig2, ...)
```

## Validate manifest (JSON)
```bash
MANIFEST=../blackcat-crypto-manifests/contexts/core.json
blackcat crypto manifest:validate "$MANIFEST"
blackcat crypto manifest:validate "$MANIFEST" --json
```

## Rotate keys (dry run)
```bash
MANIFEST=../blackcat-crypto-manifests/contexts/core.json
blackcat crypto key:rotate core.crypto.default ./keys --manifest="$MANIFEST" --dry-run
blackcat crypto key:rotate core.hmac.email ./keys --manifest="$MANIFEST" --format=base64 --dry-run
```

## Lint keys (CI gate)
```bash
MANIFEST=../blackcat-crypto-manifests/contexts/core.json
KEYS_DIR=./keys

blackcat crypto keys:lint --manifest="$MANIFEST" --keys-dir="$KEYS_DIR"
blackcat crypto keys:lint --manifest="$MANIFEST" --keys-dir="$KEYS_DIR" --json
```

## Key sources

Filesystem (recommended): `*_vN.key` (raw bytes). Optional: `*_vN.hex`, `*_vN.b64`.
Runtime note: for security hardening, key material should come from a filesystem boundary (or a secrets-agent boundary), not from environment variables.

## Export telemetry
- JSON: `blackcat crypto metrics:export`
- Prometheus: `blackcat crypto metrics:export prom`
- OTLP/JSON: `blackcat crypto metrics:export otel`

## Intent telemetry
```bash
export BLACKCAT_CRYPTO_INTENTS=1
blackcat crypto telemetry:intents --format=otel --limit 10
```

## Governance auto-approval API
```bash
curl -X POST https://yourdomain/governance.php \
  -H 'Content-Type: application/json' \
  -d '{"tenant":"acme","sensitivity":"low","amount":500,"reason":"report export"}'
```

Environment toggles:

- `GOV_MAX_AUTO` (default `10000`) / `GOV_MAX_SENSITIVITY` (default `low`)
- `GOV_RATE_BURST` (default `50`) / `GOV_RATE_WINDOW` seconds (default `60`)
- `GOV_TENANT_LIMITS_JSON` e.g. `{"acme":{"max_amount":2000,"max_sensitivity":"medium"}}`

## Approval inbox (governance feed)
```php
use BlackCat\Crypto\Governance\ApprovalInbox;
use BlackCat\Crypto\Governance\GovernanceReporter;
use BlackCat\Crypto\Telemetry\IntentCollector;

$collector = new IntentCollector();
IntentCollector::global($collector);

$inbox = new ApprovalInbox(
    new GovernanceReporter(),
    $collector
);

$id = $inbox->enqueue([
    'request_id'    => 'req-123',
    'tenant'        => 'acme',
    'sensitivity'   => 'low',
    'risk'          => 'unwrap',
    'reason'        => 'analytics export',
    'kms_client'    => 'primary-http',
    'cipher_suite'  => 'xchacha20',
    'db_hook'       => 'system-jobs',
    'pii_label'     => 'none',
]);

// approve/deny later (also emits telemetry)
$inbox->approve($id, ['approver' => 'alice@example.com']);
// $inbox->deny($id, ['approver' => 'bob@example.com', 'reason' => 'over limit']);
```

## Wrap queue
```bash
# Configure in runtime config:
# {
#   "crypto": { "wrap_queue": "file:///tmp/blackcat-wrap.queue" }
# }

# check status/backlog
blackcat crypto wrap:queue status --limit 25

# process jobs (writes updated envelopes to STDOUT or to --dump-dir)
blackcat crypto wrap:queue run --limit 50 --dump-dir=./rewrap-out
```

## CI-aware telemetry
```bash
# pass CI env so DB hooks tag build info
GITHUB_ACTIONS=true GITHUB_RUN_ID=12345 \
  blackcat crypto metrics:export otel
```

## DB crypto snapshots (for db-crypto CI)
```bash
DB_CRYPTO_SNAPSHOT_PATH=./artifacts/db-crypto.json blackcat crypto db:snapshot --format json
blackcat crypto db:snapshot prom > ./artifacts/db-crypto.prom
blackcat crypto db:snapshot --format otel --output ./artifacts/db-crypto-otel.json
```

## KMS client config (HTTP)
Runtime config (example):

```json
{
  "crypto": {
    "kms_endpoints": [
      {
        "id": "primary-http",
        "type": "http",
        "endpoint": "https://kms.example.com",
        "headers": { "X-Tenant": "acme" },
        "timeouts": { "connect": 2, "read": 5 }
      }
    ]
  }
}
```

## KMS client config (HSM)
Runtime config (example):

```json
{
  "crypto": {
    "kms_endpoints": [
      {
        "id": "pci-hsm",
        "type": "hsm",
        "endpoint": "hsm://slot1",
        "allow_ciphers": ["aes-256-gcm", "aes-192-gcm"],
        "tag_length": 16
      }
    ]
  }
}
```
