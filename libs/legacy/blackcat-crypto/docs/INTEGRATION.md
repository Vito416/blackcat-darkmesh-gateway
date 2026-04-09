# Integration Cookbook

This document shows the recommended “copy-paste” integration for other BlackCat modules and services.

## Install

```bash
composer require blackcat/crypto
```

## Minimal setup (local keys only)

1) Create a runtime config file (recommended: `/etc/blackcat/config.runtime.json`) with:

- `crypto.keys_dir`
- `crypto.manifest`

Example:

```json
{
  "crypto": {
    "keys_dir": "/etc/blackcat/keys",
    "manifest": "/etc/blackcat/crypto/contexts/core.json"
  }
}
```

2) Generate versioned keys for the slots you use:

```bash
blackcat crypto manifest:validate /etc/blackcat/crypto/contexts/core.json

# writes files like keys/crypto_key_v1.key (raw bytes)
blackcat crypto key:rotate core.crypto.default /etc/blackcat/keys --manifest=/etc/blackcat/crypto/contexts/core.json
blackcat crypto key:rotate core.vault /etc/blackcat/keys --manifest=/etc/blackcat/crypto/contexts/core.json
blackcat crypto key:rotate core.hmac.email /etc/blackcat/keys --manifest=/etc/blackcat/crypto/contexts/core.json --length=64

# CI gate (recommended)
blackcat crypto keys:lint --manifest=/etc/blackcat/crypto/contexts/core.json --keys-dir=/etc/blackcat/keys
```

3) Boot crypto in your application:

```php
use BlackCat\Crypto\Bootstrap\PlatformBootstrap;

$crypto = PlatformBootstrap::boot();
```

## Key sources

- **Filesystem (recommended):** `*_vN.key` (raw bytes), plus optional `*_vN.hex` and `*_vN.b64`.

Notes:
- Key IDs are canonicalized to `<keyname>_vN.key` regardless of source/extension (safe to store as `*_key_version`).
- Key material is length-validated against the slot `length` from the manifest.
- `key:generate` is deprecated; use `key:rotate`.

## Using AEAD

Context encryption is the default API. With no KMS clients configured, the envelope uses `client=local` metadata.

```php
$envelope = $crypto->encryptContext('users.pii', $plaintext);
$row['secret'] = $envelope->encode();

$plaintext = $crypto->decryptContext('users.pii', $row['secret']);
```

For “local-only” payloads (no envelope metadata):

```php
$payload = $crypto->encryptLocal('users.pii', $plaintext);
$plaintext = $crypto->decryptLocal('users.pii', $payload);
```

## Using HMAC (rotation-safe DB pattern)

HMACs are returned as **binary** 32-byte signatures (HMAC-SHA256). Recommended pattern:

- Store the signature in a binary column (e.g. `BINARY(32)` / `VARBINARY(32)`).
- Store `keyId` alongside it (e.g. `VARCHAR(128)`), or store a parsed version number if you prefer.

```php
$out = $crypto->hmacWithKeyId('core.hmac.email', $message);
$signature = $out['signature']; // 32 bytes (binary)
$keyId = $out['keyId'];         // e.g. email_hash_key_v3.key

// verify later (fast-path; uses only the referenced key id)
$ok = $crypto->verifyHmacWithKeyId('core.hmac.email', $message, $signature, $keyId);
```

When you need to lookup by HMAC but you do not know the stored key id/version (e.g. legacy rows), use candidates:

```php
$candidates = $crypto->hmacCandidates('core.hmac.email', $message);
// Query with IN (...) over candidate signatures and then verify the returned row.
```

## Optional: KMS wrapping

Configure KMS endpoints in runtime config (`crypto.kms_endpoints`).

Example:

```json
{
  "crypto": {
    "kms_endpoints": [
      { "id": "primary", "type": "http", "endpoint": "https://kms.example.com" }
    ]
  }
}
```

If no suitable KMS client matches a given context, `CryptoManager` falls back to local-only metadata.

## Optional: rotation queue

Rotation is asynchronous: if a rotation policy matches an envelope, `CryptoManager` enqueues a wrap job.

Configure wrap queue in runtime config (`crypto.wrap_queue`), e.g. `file:///var/lib/blackcat/wrap.queue`.

Process the queue (writes updated envelopes to STDOUT or `--dump-dir`):

```bash
blackcat crypto wrap:queue run --limit 50 --dump-dir=./rewrap-out
```

## Optional: blackcat-core bridge

If `blackcat-core` is installed, `PlatformBootstrap::boot()` also initializes legacy engines so that:

- `BlackCat\Core\Security\Crypto` uses `blackcat-crypto` slots/keys
- legacy payloads without `key_id` remain decryptable

## Database encryption (blackcat-database-crypto)

This repo intentionally contains **no database code**.

To get “zero-boilerplate” encrypted write paths (create/update/upsert) in generated repositories, use:

- `blackcatacademy/blackcat-database`
- `blackcatacademy/blackcat-database-crypto` (DB ingress + encryption map)

`PlatformBootstrap::boot()` can configure `IngressLocator` if those packages are installed.
