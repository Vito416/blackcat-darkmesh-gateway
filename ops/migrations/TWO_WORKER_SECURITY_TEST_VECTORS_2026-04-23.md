# Two-worker DM1 security test vectors (adversarial)

Date: 2026-04-23  
Status: QA assets for parser/validator/verifier hardening

## Scope

- `site-mailer-worker`:
  - TXT envelope parsing and validation
  - Config JSON validation (format + window + TXT kid binding)
- `site-inbox-worker`:
  - Route assertion signing + verification edge behavior

## Baseline fixtures

### TXT payload (raw)

```text
v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=3600
```

### Config payload (JSON)

```json
{
  "v": "dm1",
  "domain": "example.com",
  "siteProcess": "AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC",
  "writeProcess": "ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ",
  "entryPath": "/",
  "validFrom": 1760000000,
  "validTo": 1790000000,
  "sigAlg": "rsa-pss-sha256",
  "sig": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "kid": "ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ"
}
```

### Assertion envelope (verified path)

- Generated through `/route/assert` and verified through `/route/assert/verify`.
- `v` expected: `dm-route-assert/1`

---

## Adversarial vectors

### A) TXT envelope injection / duplicate keys / overflow

| ID | Payload / Mutation | Expected result |
|---|---|---|
| TXT-ADV-001 | `v=dm1;cfg=...;kid=...;ttl=3600;ttl=7200` | Reject: `txt_duplicate_key` |
| TXT-ADV-002 | `v=dm1;cfg=...;kid=...;ttl=3600;role=admin` | Reject: `txt_unknown_key` |
| TXT-ADV-003 | `v=dm1;cfg=<129-char>;kid=...;ttl=3600` | Reject: `txt_invalid_cfg` |
| TXT-ADV-004 | `v=dm1;cfg=...;kid=...;ttl=9999999999` | Reject: `txt_invalid_ttl` |
| TXT-ADV-005 | `v=dm1;cfg=...;kid=...;ttl=59` | Reject: `txt_invalid_ttl` |

### B) Config signature tampering

| ID | Mutation | Expected result |
|---|---|---|
| CFG-ADV-001 | `sig` contains invalid chars (e.g. `!!!`) | Reject: `config_invalid_field` |
| CFG-ADV-002 | `sigAlg = ed25519` | Reject: `config_invalid_field` |
| CFG-ADV-003 | `validTo <= validFrom` | Reject: `config_invalid_time_window` |
| CFG-ADV-004 | `kid` mismatches TXT `kid` | Reject: `config_kid_mismatch` |
| CFG-ADV-005 | `sig` changed but still base64-like | Schema/format may pass; MUST fail at crypto verify stage (out-of-band) |

### C) Route assertion replay / expiry edges

| ID | Mutation / Sequence | Expected result |
|---|---|---|
| RAS-ADV-001 | Verify same signed assertion twice | Current behavior: both may pass; mark as replay risk unless nonce cache enforced upstream |
| RAS-ADV-002 | Valid signature but `exp < now` | Reject: `expired_assertion` |
| RAS-ADV-003 | Valid signature but `challengeExp < exp` | Reject: `bad_shape` |
| RAS-ADV-004 | Valid signature but `iat > now + skew` | Reject: `assertion_not_yet_valid` |
| RAS-ADV-005 | Valid signature but wrong `expectedDomain` | Reject: `domain_mismatch` |

---

## Verification order (recommended)

1. Schema/shape validation.
2. Cross-object consistency (TXT ↔ config ↔ assertion).
3. Signature verification.
4. Time-window checks.
5. Replay controls (nonce/jti single-use).
6. HB target integrity probe.

## Notes

- DM1 config validator currently enforces signature *format*, not cryptographic truth by itself.
- Replay prevention is policy/stateful behavior and must be implemented in verifier context or edge cache layer.

## Schema harness coverage and limits

- `workers/site-mailer-worker/test/schema-harness.test.ts` validates representative valid/invalid payloads for:
  - `dm1-dns-txt.schema.json`
  - `dm1-config.schema.json`
  - `dm1-route-assertion.schema.json`
- The harness is intentionally lightweight and deterministic for CI and checks a strict subset of JSON Schema features used by current DM1 schemas (`type`, `required`, `properties`, `additionalProperties`, `const`, `enum`, `pattern`, numeric/string/array bounds).
- Limits:
  - It does **not** execute custom runtime policy from `x-runtimeRules` (time-window ordering, replay state, cryptographic verification).
  - It does **not** replace parser/validator/runtime tests; it guards schema drift and representative contract compatibility.
