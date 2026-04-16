# AO Integrity Snapshot Contract v1

This folder documents the versioned AO integrity snapshot contract consumed by
`blackcat-darkmesh-gateway`.

Canonical schema:
- `integrity-snapshot-v1.schema.json`

The gateway currently accepts two transport shapes:
1. the raw integrity snapshot object, and
2. an AO codec envelope with `status: "OK"` wrapping the snapshot under
   `payload`, `body`, `result`, or `data`.

The raw snapshot object is the canonical contract surface for producers. The
codec envelope is only a compatibility wrapper for the current parser.

## Compatibility table

| Contract surface | Required shape | Parser behavior on violation |
| --- | --- | --- |
| Raw snapshot | Object with `release`, `policy`, `authority`, `audit` | Rejects with `integrity_invalid_snapshot` if the payload is not a JSON object or any required section is malformed. |
| AO codec wrapper | `status: "OK"` plus `payload`, `body`, `result`, or `data` | Rejects with `integrity_fetch_failed` when `status === "ERROR"`; rejects with `integrity_invalid_snapshot` when `status === "OK"` but no nested snapshot field is present. |
| `release.root` | Non-empty string | Rejects with `missing_trusted_root` if missing or blank. |
| `policy.activeRoot` | Non-empty string matching `release.root` | Rejects with `missing_trusted_root` if missing or blank; rejects with `integrity_release_root_mismatch` if it diverges from `release.root`. |
| `release.revokedAt` | Omitted on the active snapshot | Rejects with `integrity_release_root_mismatch` if the active snapshot is marked revoked. |
| `policy.paused` | Boolean | Rejects with `integrity_invalid_snapshot` if the value is not a boolean. |
| `policy.maxCheckInAgeSec` | Finite number | Rejects with `integrity_invalid_snapshot` if the value is not a finite number. |
| `policy.compatibilityState.root` | Optional non-empty string equal to `release.root` or `policy.activeRoot` | Rejects with `integrity_release_root_mismatch` if it points at any other root. |
| `authority.signatureRefs` | Array of non-empty strings | Rejects with `integrity_invalid_snapshot` if any member is blank or non-string. |
| `audit.seqFrom` / `audit.seqTo` | Finite numbers | Rejects with `integrity_invalid_snapshot` if either value is not a finite number. |

## Top-level snapshot shape

Required fields:
- `release`
- `policy`
- `authority`
- `audit`

Optional fields:
- any additional top-level fields are currently tolerated by the gateway
  parser, but producers should not depend on them for compatibility.

## `release`

Required fields:
- `componentId`
- `version`
- `root`
- `uriHash`
- `metaHash`
- `publishedAt`

Optional fields:
- `revokedAt`

Compatibility notes:
- `root` must match `policy.activeRoot` for the active snapshot to be accepted.
- `revokedAt` is parseable, but the current gateway rejects it on the active
  snapshot path.
- These values are treated as opaque strings by the gateway parser; keep them
  non-empty and stable.

## `policy`

Required fields:
- `activeRoot`
- `activePolicyHash`
- `paused`
- `maxCheckInAgeSec`

Optional fields:
- `pendingUpgrade`
- `compatibilityState`

`pendingUpgrade` fields:
- `root`
- `hash`
- `expiry`
- `proposedAt`

`compatibilityState` fields:
- `root`
- `hash`
- `until`

Compatibility notes:
- `activeRoot` must match `release.root`.
- `compatibilityState.root` is accepted only when it matches `release.root`
  or `policy.activeRoot`.
- `paused` must be a boolean.
- `maxCheckInAgeSec` is parsed as a finite number; use integer seconds in
  production snapshots.

## `authority`

Required fields:
- `root`
- `upgrade`
- `emergency`
- `reporter`
- `signatureRefs`

Compatibility notes:
- `signatureRefs` is an array of signer reference strings.
- The gateway parser accepts an empty array, but production snapshots should
  publish the refs actually used by operator workflows.

## `audit`

Required fields:
- `seqFrom`
- `seqTo`
- `merkleRoot`
- `metaHash`
- `reporterRef`
- `acceptedAt`

Compatibility notes:
- `seqFrom` and `seqTo` are parsed as finite numbers.
- The gateway uses these values for audit lag and sequence progression checks.

## AO codec envelope compatibility

The current gateway parser unwraps codec responses when `status === "OK"` and
looks for the raw snapshot under one of:
- `payload`
- `body`
- `result`
- `data`

If `status === "ERROR"`, the fetch is treated as a failure and the envelope is
not considered a valid snapshot response.

## Versioning rules

- Keep this contract in sync with the parser behavior in
  `src/integrity/client.ts`.
- Bump the schema file name and document a new version when the required field
  surface changes.
- Prefer additive AO fields only when the gateway parser intentionally ignores
  them.
- Do not remove or rename required fields without a coordinated parser change
  and a new schema version.

## Example

```json
{
  "release": {
    "componentId": "gateway",
    "version": "1.2.0",
    "root": "root-abc",
    "uriHash": "uri-123",
    "metaHash": "meta-456",
    "publishedAt": "2026-04-09T12:00:00Z"
  },
  "policy": {
    "activeRoot": "root-abc",
    "activePolicyHash": "policy-789",
    "paused": false,
    "maxCheckInAgeSec": 86400
  },
  "authority": {
    "root": "sig-root",
    "upgrade": "sig-upgrade",
    "emergency": "sig-emergency",
    "reporter": "sig-reporter",
    "signatureRefs": ["sig-root", "sig-upgrade"]
  },
  "audit": {
    "seqFrom": 1,
    "seqTo": 3,
    "merkleRoot": "audit-root",
    "metaHash": "audit-meta",
    "reporterRef": "sig-reporter",
    "acceptedAt": "2026-04-09T12:00:00Z"
  }
}
```
