# BlackCat Crypto Policy Bundle

This directory is the gateway-owned crypto policy bundle used across the Blackcat stack.

It defines stable, auditable crypto context names and key requirements so gateway, worker, AO, and write stay consistent.

## What lives here

- `contexts/*.json`: context maps for allowed crypto slots and rotation hints.
- `bin/manifest-lint`: basic structural validator for context files.

## Policy scope

Manifests describe:

- slot names (for example `core.crypto.default`, `core.hmac.csrf`);
- slot requirements (`type`, `key`, `length`);
- optional rotation metadata (`maxAgeSeconds`, `maxWraps`).

This package is intentionally data-first and does not hold runtime secrets.

## Usage

Point runtime config to a manifest file:

```json
{
  "crypto": {
    "manifest": "../security/crypto-policy/contexts/core.json"
  }
}
```

Validate manifests:

```bash
security/crypto-policy/bin/manifest-lint [contexts-dir]
```

## Manifest shape

```json
{
  "slots": {
    "core.crypto.default": { "type": "aead", "key": "crypto_key", "length": 32 },
    "core.hmac.csrf": { "type": "hmac", "key": "csrf_key", "length": 64 }
  },
  "rotation": {
    "core.crypto.default": { "maxAgeSeconds": 2592000, "maxWraps": 5 }
  }
}
```

## Licensing

This policy bundle is an official component of the Blackcat Covered System and follows the repository root `LICENSE` (`BFNL-1.0`).

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
