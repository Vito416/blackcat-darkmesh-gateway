# HyperBEAM config changelog and future guide (config-only)

Date: 2026-04-21  
Scope: production-like Darkmesh HB runtime on VPS  
Policy: **no HyperBEAM source-code modifications** (stock HB only)

## 1) Operating principle

Darkmesh keeps HyperBEAM as a stock runtime component.

- Allowed: infrastructure and proxy configuration changes (`cloudflared`, `nginx`, DNS, AO policy wiring).
- Not allowed: patching or forking HyperBEAM core code for domain onboarding.

This keeps operator onboarding simple and future-compatible with upstream HB releases.

## 2) What changed (current state)

## 2.1 Cloudflared ingress fallback

File: `/etc/cloudflared/config.yml`

Change:

- before:
  - `- service: http_status:404`
- now:
  - `- service: http://127.0.0.1:8744`

Reason:

- allow temporary demo-domain onboarding without adding per-domain tunnel host entries,
- avoid immediate tunnel-level 404 for unknown hostnames.

Impact:

- transport layer forwards unmatched hostnames to the local HB front path,
- does not change SSH/Tailscale/UFW boundaries,
- increases public L7 surface (expected in demo onboarding phase).

## 2.2 Nginx loopback redirect behavior

File: `/etc/nginx/sites-available/hyperbeam-loopback.conf`

Change:

- added `absolute_redirect off;`

Reason:

- prevent redirects from leaking internal origin shape (`http://<host>:8744/...`),
- keep browser-facing redirects compatible through Cloudflare tunnel/proxy.

Impact:

- root redirect becomes relative (`Location: /~meta@1.0/info`),
- no new exposed port,
- no admin access surface increase.

## 2.3 Control-plane transport split for public HB hostname

File: `/etc/cloudflared/config.yml`

Change:

- `hyperbeam.darkmesh.fun` is routed directly to `http://127.0.0.1:8734` (stock HB)
- catch-all remains on `http://127.0.0.1:8744` (nginx loopback front path)

Reason:

- remove the `cloudflared -> nginx -> hb` hop for control-plane sends on the primary HB hostname,
- keep demo domain onboarding behavior for unmatched hosts.

Observed validation after change:

- `GET https://hyperbeam.darkmesh.fun/~meta@1.0/info` -> `200`
- signed ANS104 scheduler POST to `https://hyperbeam.darkmesh.fun` -> HB-native `500 process_not_available` (transport path works; no edge `502`)
- demo domains still pass root/meta smoke checks under catch-all profile.

Current limitation:

- control-plane scheduler sends through catch-all demo domains can still hit `502` (`nginx` upstream header boundary),
- therefore control-plane writes must use `hyperbeam.darkmesh.fun` (or push/push1 fallback) until loopback profile is retired or split further.

## 2.4 Runtime tuning profile (score-oriented, still config-only)

Files:
- `/srv/darkmesh/hb/entrypoint.sh`
- `/srv/darkmesh/hb/docker-compose.yml`

Change:
- Added explicit tuning env knobs in runtime config generation:
  - `HB_NUM_ACCEPTORS` (default `64`)
  - `HB_MAX_CONNECTIONS` (default `4096`)
  - `HB_ARWEAVE_INDEX_WORKERS` (default `24`)
  - `HB_LMDB_MAX_READERS` (default `1024`)
  - `HB_LMDB_CAPACITY` (default `137438953472`, 128 GiB)
- Added Docker `ulimits.nofile`:
  - soft/hard `1048576`

Reason:
- improve concurrent request handling headroom and reduce fd/accept bottlenecks under higher inbound load,
- keep settings adjustable via env without touching HB code.

Impact:
- no protocol or policy behavior change,
- no new public port exposure,
- higher resource headroom for request serving and indexing.

## 2.5 Cloudflared host-header normalization for control-plane parity

File: `/etc/cloudflared/config.yml`

Change:
- for `hyperbeam.darkmesh.fun` ingress route, added:
  - `originRequest.httpHostHeader: 127.0.0.1`

Reason:
- direct public calls with host header `hyperbeam.darkmesh.fun` were triggering
  host-sensitive route/device behavior (`/push` returned non-control-plane page
  body and module fetch occasionally failed with `module_not_admissable` under
  that host context),
- normalize origin host for the HB control-plane route to keep behavior aligned
  with loopback parity tests.

Validation after change:
- `GET https://hyperbeam.darkmesh.fun/<module>~module@1.0?accept-bundle=true` -> `200`
- spawn with local scheduler succeeded via public endpoint:
  - scheduler: `_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM`
  - new PID: `l_0YGt3W5KBM2kVHa9uEz8yFmbU_wj-D3rR4Ez-xVzo`
- direct scheduler send check succeeded:
  - `POST /~scheduler@1.0/schedule?target=<new_pid>` -> `200` (`slot=1`)

Impact:
- no HB source-code change,
- preserves tunnel security boundary,
- stabilizes public control-plane behavior for local-scheduler flows.

## 2.6 Runtime route parity closure (`/result` + `/dry-run`)

Files:
- `/srv/darkmesh/hb/entrypoint.sh`
- `/srv/darkmesh/hb/docker-compose.yml`

Change:
- added explicit remote relay routes:
  - `^/result/[0-9]+$`
  - `^/dry-run$`
- route targets are configurable but default to the same `REMOTE_GATEWAY`.

Reason:
- eliminate delegated-compute `no_viable_route` failures where `/<pid>/now` internally resolves to `/result/<slot>?process-id=<pid>`,
- close known route gap observed in parity diagnostics.

Impact:
- no HB source-code change,
- write/control-plane path unchanged,
- compute/read relay path gains explicit route coverage.

## 2.7 Write ingress guard (noise/error reduction)

Files:
- `/etc/nginx/sites-available/write-loopback.conf`
- `/etc/cloudflared/config.yml` (optional strict mode: `write.<domain>` -> `127.0.0.1:8745`)

Change:
- introduced optional dedicated write loopback listener in nginx (`127.0.0.1:8745`) in front of raw HB port:
  - blocks common scanner paths before HB,
  - forces `POST` for `/push` and `/~process@1.0/push` (returns `405` for invalid methods),
  - proxies all other control-plane traffic unchanged.

Reason:
- reduce avoidable HB `500` noise caused by malformed `GET` probes on push-style endpoints,
- keep parity behavior while hardening edge behavior.

Impact:
- no HB source-code change,
- lowers noisy invalid-request error volume,
- keeps valid signed write paths compatible when enabled.

## 2.8 Strict stock runtime reset (no custom HB build profile)

Files:
- `/srv/darkmesh/hb/Dockerfile`
- `/srv/darkmesh/hb/entrypoint.sh`
- `/srv/darkmesh/hb/docker-compose.yml`

Change:
- reverted runtime image path to stock `rebar3 release` profile,
- removed local `genesis-wasm` sidecar routing assumptions from runtime defaults,
- kept `/result` and `/dry-run` routes but pointed them back to remote gateway (`https://arweave.net`) using `node.prefix`,
- normalized route config style to `prefix` routes (same style as HB examples).

Reason:
- reduce attack surface and operational drift from upstream HB image behavior,
- keep deployment reproducible for other operators without custom runtime internals.

Validation after reset:
- `https://hyperbeam.darkmesh.fun/~meta@1.0/info` -> `200`,
- parity gate passed on write endpoint:
  - `hb-full-parity-gate.sh --hb-url https://write.darkmesh.fun ...` -> `PASS`,
  - signed scheduler ping returned `200` with slot/process headers,
- fresh spawn via write endpoint succeeded:
  - PID `zUiUuFej6MzmnOJFPWFBvyvG9X1UPQHWnuQ_LAm4fMk`
  - scheduler `_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM`

Impact:
- stays within "config-only + stock HB" rule,
- keeps control-plane parity for the current project scheduler flow,
- avoids dependence on local custom wasm launcher internals.

## 3) Why these changes are acceptable

- They are runtime-proxy configuration only.
- They do not alter HyperBEAM core behavior or code.
- They solve onboarding and redirect correctness issues in front of stock HB.

## 4) Known trade-offs

1. Catch-all ingress means unknown hosts are forwarded to HB front path instead of tunnel 404.
2. Access policy is not enforced in cloudflared itself (by design); business policy must be enforced by AO/HB policy layer.
3. AO host binding is still required (`BindDomain`) for proper site resolution.

## 5) Guardrails while catch-all is enabled

1. Keep admin/signer endpoints outside public ingress.
2. Keep strict host->site validation in AO/HB resolution path.
3. Keep rate limits and body limits on write routes.
4. Monitor unknown-host spikes and deny/fallback metrics.
5. Maintain emergency rollback to strict fallback 404.
6. Do not use catch-all domains as control-plane write targets.

## 6) Future improvements (still config-only)

## 6.1 Near-term (safe)

- Add explicit domain entries for stable production domains, keep catch-all only for onboarding windows.
- Keep `DM_POLICY_MODE=off` until observe metrics are stable.
- Add automatic alerting on unknown host volume.

## 6.2 Mid-term (future-proof)

- Move paid/free and allow/deny decisions to AO-signed policy snapshots consumed by HB-side evaluator.
- Rollout path: `off -> observe -> soft -> enforce`.
- Keep cloudflared transport-only; do not turn it into policy authority.

## 6.3 Long-term operator model

- Define an operator contract for stock HB nodes:
  - accepted host handling baseline,
  - signed policy snapshot consumption,
  - consistent metrics export for reward evidence.
- Preserve stock HB upgrade path with no core-code fork.

## 7) Rollback card

If catch-all behavior is not desired:

1. Set cloudflared fallback back to `http_status:404`.
2. Restart tunnel service.
3. Keep explicit hostnames only.

If redirect behavior must be reverted:

1. Remove `absolute_redirect off;` from nginx loopback server.
2. Reload nginx.
3. Re-test `Location` headers for external correctness.

## 8) Validation checklist after any config change

- `cloudflared tunnel ingress validate` returns `OK`.
- `systemctl status cloudflared-tunnel.service` is healthy.
- `nginx -t` returns valid config.
- `https://hyperbeam.<domain>/~meta@1.0/info` returns `200`.
- demo domain root + meta endpoint pass smoke checks.
- AO `site-by-host` returns expected site mapping (or documented `NOT_FOUND` if intentionally unbound).

## 9) Final note

This document intentionally separates **transport config changes** from **policy/business logic changes**.

- Transport config is already acceptable now.
- Policy and reward controls should be added on top, without modifying HB source.
