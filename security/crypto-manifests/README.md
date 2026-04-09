# BlackCat Crypto Manifests (Gateway Snapshot)

Shared, declarative manifests for cryptographic contexts/slots across the BlackCat ecosystem.
This is a vendored snapshot kept inside `blackcat-darkmesh-gateway/security/crypto-manifests`.

Manifests describe:
- AEAD/HMAC slot names (`core.crypto.default`, `core.hmac.csrf`, ...),
- key requirements (`type`, `length`),
- optional rotation policies and KMS bindings (consumed by `blackcat-crypto`).

This package is intentionally **data-only**: JSON/YAML manifests are loaded by `blackcat-crypto`,
`blackcat-crypto-js`, and other ecosystem components so slot naming stays consistent and audited.

```
security/crypto-manifests/
├── README.md
├── SNAPSHOT.md
├── docs/
│   └── ROADMAP.md
└── contexts/
    └── core.json
```

## Usage

Point your runtime config at a manifest file (recommended):

```json
{
  "crypto": {
    "manifest": "../security/crypto-manifests/contexts/core.json"
  }
}
```

`blackcat-crypto` loads the manifest via `CryptoConfig` and registers defined slots + rotation
policies in `CryptoManager`. CLI commands can also accept `--manifest=path` explicitly.

Validate manifests:

```bash
bin/manifest-lint [contexts-dir]
```

## Manifest format

Each manifest contains:

```json
{
  "slots": {
    "core.crypto.default": {"type": "aead", "key": "crypto_key", "length": 32},
    "core.hmac.csrf": {"type": "hmac", "key": "csrf_key", "length": 64}
  },
  "rotation": {
    "core.crypto.default": {"maxAgeSeconds": 2592000, "maxWraps": 5}
  }
}
```

Add new slots/contexts here and reference the updated manifest from other repos. No duplication.

## Licensing

This package is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
