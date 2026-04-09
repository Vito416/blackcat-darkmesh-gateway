# Troubleshooting

## Manifest issues

**Symptom:** `Manifest is not readable` / `Manifest is not valid JSON` / `slots must be a non-empty object`.

- Verify your runtime config points to an existing JSON file:
  - `crypto.manifest=/path/to/contexts/core.json`
- Validate it:
  - `blackcat crypto manifest:validate /path/to/contexts/core.json`

## Keys dir not detected

**Symptom:** `CoreCryptoBridge requires readable keys_dir directory` or `Keys directory is not readable`.

- Ensure runtime config `crypto.keys_dir` points to a real directory with read permission.
- Lint keys against the manifest:
  - `blackcat crypto keys:lint --manifest=/path/to/contexts/core.json --keys-dir=/path/to/keys`

## Wrong key length / invalid encoding

**Symptom:** `matching files exist but none are valid (decode/length)` or `invalid ... length mismatch`.

- Generate the correct key length for the slot:
  - `blackcat crypto key:rotate <slot> /path/to/keys --manifest=/path/to/contexts/core.json`
- Remember:
  - `.key` files are **raw bytes** (length must match exactly).
  - `.hex` must decode to the exact slot length.
  - `.b64` must decode to the exact slot length.

## HMAC verification fails after rotation

**Symptom:** old rows become unverifiable after rotating HMAC keys.

- Store and use the signing key id (`*_key_version`) and verify via the fast-path:
  - `CryptoManager::verifyHmacWithKeyId($slot, $message, $sig, $keyId)`
- If you must lookup without knowing the key id/version, compute candidates and query via `IN (...)`:
  - `CryptoManager::hmacCandidates($slot, $message)`

## “KMS not used” / local metadata only

**Symptom:** envelopes show `"client":"local"` in KMS metadata.

- That means no KMS client matched the context, or no KMS was configured.
- Provide runtime config `crypto.kms_endpoints` (JSON array or `id=endpoint,...`) and (optionally) `contexts` patterns per client.

## CI differences

**Symptom:** things work locally but fail in CI.

- Ensure CI has access to the same manifest and keys (or generates them deterministically).
- Use `keys:lint` in your application repos as an early gate.
