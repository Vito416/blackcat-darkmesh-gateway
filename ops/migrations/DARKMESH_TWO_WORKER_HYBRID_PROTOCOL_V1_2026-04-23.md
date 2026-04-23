# Darkmesh two-worker hybrid protocol v1 (no standalone resolver)

Date: 2026-04-23  
Status: design spec (implementation target)

## 1) Intent

Enable very simple domain onboarding:

1. user points domain DNS to Darkmesh HB ingress,
2. user sets `_darkmesh` TXT with a pointer to config JSON on Arweave,
3. site resolves and serves.

Constraints:
- no HyperBEAM source-code patching,
- no standalone resolver server,
- exactly 2 workers per site owner:
  - Secrets Worker: runtime/secrets,
  - Async Worker: async/cron.

## 2) Trust model

HB treats all workers as untrusted by default.

A route is accepted only when all checks pass:
- DNS TXT record is valid,
- Arweave config JSON is valid and signed,
- runtime assertion from Secrets Worker is valid and challenge-bound,
- HB target existence/probe checks pass.

## 3) Actors

- **User domain owner** (runs Secrets Worker + Async Worker in own CF account)
- **HyperBEAM node** (`hyperbeam.darkmesh.fun`)
- **Arweave storage** (`cfg` JSON tx)
- **DNS zone**

## 4) DNS and config primitives

### TXT record

`_darkmesh.<domain> = "v=dm1;cfg=<AR_TX>;kid=<OWNER_KID>;ttl=3600"`

Required:
- `v`: protocol version,
- `cfg`: Arweave tx id of config JSON,
- `kid`: owner key id/address,
- `ttl`: desired cache ttl.

### Arweave config JSON (`cfg`)

```json
{
  "v": "dm1",
  "domain": "example.com",
  "ownerKid": "AR_OWNER_ADDRESS",
  "runtimeWorkerUrl": "https://runtime.example.workers.dev",
  "asyncWorkerUrl": "https://async.example.workers.dev",
  "siteProcess": "AO_PROCESS_ID",
  "writeProcess": "AO_WRITE_PROCESS_ID",
  "entryPath": "/",
  "allowedHbHosts": ["hyperbeam.darkmesh.fun"],
  "validFrom": 1760000000,
  "validTo": 1790000000,
  "nonce": "uuid-v4",
  "cfgHash": "sha256-hex-over-canonical-json",
  "sigAlg": "rsa-pss-sha256",
  "sig": "BASE64_SIGNATURE_BY_ownerKid"
}
```

## 5) Secrets Worker runtime assertion contract

Secrets Worker signs a short-lived route assertion only after receiving a challenge from HB.

### Request from HB to Secrets Worker

`POST /route/assert`

```json
{
  "domain": "example.com",
  "cfgTx": "AR_TX_ID",
  "hbHost": "hyperbeam.darkmesh.fun",
  "challengeNonce": "base64-random-96b",
  "challengeExp": 1760000123
}
```

### Response from Secrets Worker

```json
{
  "v": "dm1",
  "domain": "example.com",
  "cfgTx": "AR_TX_ID",
  "siteProcess": "AO_PROCESS_ID",
  "writeProcess": "AO_WRITE_PROCESS_ID",
  "entryPath": "/",
  "cfgHash": "sha256-hex",
  "workerKid": "WORKER_SIGNING_KID",
  "iat": 1760000000,
  "exp": 1760000060,
  "challengeNonce": "base64-random-96b",
  "sigAlg": "rsa-pss-sha256",
  "sig": "BASE64_SIGNATURE_BY_workerKid"
}
```

HB must reject assertions when:
- nonce mismatch,
- expired assertion,
- config mismatch (`cfgTx`, `cfgHash`, `domain`),
- signature invalid.

## 6) Runtime flow

### Hot path (cache hit)

1. request arrives for host,
2. lookup host in validated map,
3. if `valid` and not expired: route to HB target immediately.

### Cold path (cache miss/expired)

1. read `_darkmesh.<domain>` TXT,
2. fetch `cfg` JSON from Arweave (allowlisted gateways),
3. validate `cfg` schema/signature/time/domain,
4. call Secrets Worker `route/assert` with challenge nonce,
5. validate assertion signature + challenge binding,
6. run HB target probe:
   - process/path existence,
   - optional fingerprint/hash consistency,
7. persist normalized map entry as `valid`,
8. route request.

If steps fail:
- use `stale-if-error` only inside strict grace window,
- otherwise controlled fail (`404` or `421`), never generic `500`.

## 7) Async Worker async jobs

Async Worker owns periodic control-plane tasks:

- TXT + `cfg` refresh,
- signature/time revalidation,
- Secrets Worker liveness and assertion sanity checks,
- HB target integrity probes,
- state transitions: `valid -> stale -> invalid`,
- optional manual refresh endpoint for admin tooling.

Suggested cadences:
- refresh: every 5-10 minutes,
- integrity probe: every 10-15 minutes,
- jitter enabled to avoid synchronized bursts.

## 8) Validated map schema (runtime cache)

```json
{
  "host": "example.com",
  "status": "valid",
  "cfgTx": "AR_TX_ID",
  "cfgHash": "sha256-hex",
  "siteProcess": "AO_PROCESS_ID",
  "writeProcess": "AO_WRITE_PROCESS_ID",
  "entryPath": "/",
  "runtimeWorkerUrl": "https://runtime.example.workers.dev",
  "ownerKid": "AR_OWNER_ADDRESS",
  "workerKid": "WORKER_SIGNING_KID",
  "verifiedAt": 1760000000,
  "expiresAt": 1760003600,
  "hbVerifiedAt": 1760000020,
  "hbProbeStatus": "ok",
  "lastError": null
}
```

## 9) Mandatory controls

- strict host canonicalization (lowercase + punycode),
- deny wildcard upstreams; enforce allowlist for HB and Arweave hosts,
- max JSON size and strict schema validation,
- bounded retry budgets and timeout ceilings,
- replay protection:
  - nonce cache for challenge/assertion,
  - narrow assertion TTL,
- explicit key-rotation and revoke procedure:
  - owner key and worker key independently rotatable.

## 10) Rollout plan (no downtime)

1. **Observe**
   - compute decisions + logs, do not enforce.
2. **Shadow**
   - routing decisions active, fallback still available.
3. **Enforce**
   - validated map is primary authority for route acceptance.

Rollback:
- disable enforce flag,
- retain async refresh and telemetry,
- invalidate current assertion cache if compromise suspected.
