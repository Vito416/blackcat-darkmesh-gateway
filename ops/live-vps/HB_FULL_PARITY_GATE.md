# HyperBEAM full parity gate (mandatory)

Date: 2026-04-21

## Why this exists

A node can look "healthy" for read traffic and still fail write/control-plane traffic.

Observed incident pattern:

- public site rendering works (`/`, `/~meta@1.0/info`),
- but scheduler writes via custom endpoint fail (`/~scheduler@1.0/schedule`),
- resulting in Cloudflare `502` on signed ANS104 POST,
- fallback push endpoint works.

This is **not** full parity.

## Definition of full parity

A fresh install is full-parity only when all are true on the same endpoint:

1. `GET /~meta@1.0/info` returns `200`.
2. Signed ANS104 `POST /~scheduler@1.0/schedule?target=<registry_pid>` returns `2xx`.
3. Scheduler response includes `slot` and `process` headers.

If any fails, treat endpoint as:

- read-plane only, or
- degraded control-plane.

Do not market it as full operator parity.

## Mandatory gate command (new installs)

Run after bootstrap and before onboarding domains:

```bash
bash ops/live-vps/local-tools/hb-full-parity-gate.sh \
  --hb-url https://hyperbeam.<your-domain> \
  --registry-pid <registry_pid> \
  --wallet <wallet.json>
```

Expected result:

- script exits `0`,
- reports `PASS: full parity gate passed.`,
- artifact folder saved under `tmp/hb-full-parity-gate-<timestamp>/`.

## Policy for rollout

- If gate passes:
  - use your HB endpoint for both read + control-plane.
- If gate fails:
  - keep read traffic on your HB endpoint,
  - keep control-plane writes on `push`/`push1`,
  - open a parity blocker and fix ingress path,
  - re-run gate until PASS.

## Install-time safeguard (must not regress)

For every new install image/runbook:

1. Include parity gate in bootstrap checklist.
2. Treat gate failure as blocker for "production-ready parity".
3. Keep fallback plan documented (`push`/`push1`) until gate passes.

## Latest verification run (2026-04-21, darkmesh)

- Local endpoint under test: `https://hyperbeam.darkmesh.fun`
- Local HB identity: `_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM`
- Runtime profile used:
  - `load_remote_devices=true`
  - `arweave_index_blocks=true`
  - routes added for `/graphql`, `/<43-char-id>`, `/tx/<43-char-id>`
- WASM rebuild and publish:
  - module tx: `TrNj8CSFaevoYSAsnxuQ97SkdDuPvpkgxR-L6i3QCzY`
  - module fetch check on local HB: `200`
- Spawn on local endpoint:
  - with local scheduler `_wCF...` -> `500` (`scheduler_timeout`)
  - with push scheduler `n_XZ...` -> `500` (`necessary_message_not_found`)
- Fallback spawn on push:
  - URL: `https://push.forward.computer`
  - scheduler: `n_XZJhUnmldNFo4dhajoPZWhBXuJk-OcQr5JQ49c4Zo`
  - spawned PID: `pv5L9wh5W5uHw2cYj9uMnY2-ltYQrr_5-dagIV_95Fw` (`200`)
- Gate status:
  - **FAIL on local HB for control-plane parity**
  - **PASS on push fallback for control-plane writes**

## Latest verification run (2026-04-22, strict stock reset)

- Endpoint under test: `https://write.darkmesh.fun`
- Scheduler identity used: `_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM`
- Gate command:
  - `hb-full-parity-gate.sh --hb-url https://write.darkmesh.fun --registry-pid l_0YGt3W5KBM2kVHa9uEz8yFmbU_wj-D3rR4Ez-xVzo --wallet ../blackcat-darkmesh-write/wallet.json`
- Result:
  - `PASS`
  - scheduler send `status=200`
  - response includes `slot` and `process` headers
- Artifact:
  - `tmp/hb-full-parity-gate-20260422T064448Z/`

Additional direct write-flow check:
- fresh spawn via write endpoint:
  - PID `zUiUuFej6MzmnOJFPWFBvyvG9X1UPQHWnuQ_LAm4fMk`
  - status `200`
- follow-up scheduler ping on new PID:
  - status `200`, `slot=1`

Current operational status:
- **PASS on write endpoint for read + control-plane parity**
- keep this gate as mandatory after every install/rebuild.
