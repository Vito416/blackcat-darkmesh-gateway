# AO vs Gateway live benchmark run - 2026-04-19

## Environment
- Gateway URL: `https://gateway.blgateway.fun`
- AO public API URL: configured upstream used by gateway (`/api/public/*`)
- Profile: production-like smoke benchmark
- Tooling: `scripts/build-ao-vs-gateway-scenarios.js`, `scripts/benchmark-ao-vs-gateway.js`

## Artifacts
- Scenario file: `config/bench/ao-vs-gateway.scenarios.live.json` (local operator artifact; ignored)
- Raw benchmark report: `tmp/bench/ao-vs-gateway.20260419T085558Z.json`
- Raw benchmark report (rerun after worker hardening): `tmp/bench/ao-vs-gateway.20260419T095242Z.json`
- Raw benchmark report (long-timeout rerun): `tmp/bench/ao-vs-gateway.20260419T100404Z.json`

## Result summary
Benchmark completed, but the compared paths are not in a healthy state yet, so p95/RPS comparisons are **not release-meaningful**.

Observed status patterns:
- `public.site-by-host`
  - AO direct: `502 INVALID_UPSTREAM_RESPONSE` (`invalid_registry_response`)
  - Gateway: `502`
- `public.resolve-route`
  - AO direct without site scope: `400 site_id_required`
  - AO direct with site scope + template token: `500 internal_error`
  - Gateway: `500`/timeouts under load
- `public.get-page`
  - AO direct without upstream template token: `401 unauthorized`
  - AO direct with upstream template token: `500 internal_error`
  - Gateway: `500`/timeouts under load

## Interpretation
- Benchmark tooling works end-to-end and writes reproducible JSON reports.
- The current live upstream data plane is returning functional errors (`502`/`500`/`401`), so the run currently measures failure behavior rather than AO-vs-gateway performance.

## Required before next benchmark run
1. Fix upstream `GetSiteByHost`/registry response path (remove `invalid_registry_response`).
2. Fix `resolve-route` and `page` server-side internal errors for valid site-scoped calls.
3. Re-run benchmark with healthy expected statuses (`200/404`) and then evaluate p95/RPS deltas.

---

## Rerun update (after upstream worker hardening deploy)

Applied before rerun:
- worker endpoint hardening deployed:
  - `site-by-host`: empty/atom output now maps to `404 NOT_FOUND` instead of generic `502`
  - read-path timeout failures now return explicit `504 ao_read_timeout` (instead of generic `500 internal_error`)
  - `GATEWAY_READ_TIMEOUT_MS` increased from `30000` to `60000` in production worker vars
- benchmark scenario generator updated:
  - `public.site-by-host` accepts `[200, 404]` to allow unbound-host runs
  - AO auth headers can be injected for benchmark scenarios (`--ao-api-token`, `--ao-bearer-token`, `--ao-template-token`)

Rerun snapshot (`tmp/bench/ao-vs-gateway.20260419T095242Z.json`):
- `public.site-by-host`
  - AO success: `19/24`
  - Gateway success: `17/24`
  - remaining failures: intermittent `502` from upstream semantic path
- `public.resolve-route`
  - AO success: `0/24`
  - Gateway success: `0/24`
  - dominant failures: upstream `502` and request timeouts
- `public.get-page`
  - AO success: `0/24`
  - Gateway success: `0/24`
  - dominant failures: upstream `502` and request timeouts

Conclusion after rerun:
- Hardening improved error semantics and observability (no opaque `internal_error` on read timeouts).
- However, AO read semantic readiness for route/page remains blocked; A/B performance comparison is still not release-meaningful until AO read responses are consistently semantic (`status=OK|ERROR` envelopes).

## Long-timeout rerun (to separate transport timeout vs semantic failure)

Profile override:
- `requests=6`, `concurrency=2`, `timeoutMs=70000`

Observed:
- `public.site-by-host` partially healthy:
  - AO: `5/6` success (`200|404`), `1/6` fail (`502`)
  - Gateway: `5/6` success (`200|404`), `1/6` fail (`502`)
  - p95 latency roughly `8.7s-9.8s`
- `public.resolve-route` remains blocked:
  - AO direct: `0/6` success, failures mostly `504` around `~60s`
  - Gateway: `0/6` success, failures `504` around `~30s` (gateway upstream read timeout boundary)
- `public.get-page` remains blocked:
  - AO direct: `0/6` success, failures mostly `504` around `~60s`
  - Gateway: `0/6` success, failures `504` around `~30s`

Interpretation:
- The bottleneck is upstream AO read behavior for route/page on current process/runtime path, not benchmark tooling.
- Gateway read timeout simply makes the failure surface earlier and deterministic.

---

## Decision update - 2026-04-20 (HB alpha + dedicated VPS path)

Working decision for the next architecture phase:
- We proceed with a dedicated VPS that runs:
  - HyperBEAM (stock runtime, no core fork),
  - Arweave node in non-mining mode,
  - AO process stack (`-ao`, `-write`, worker-bound signer flow).
- Program eligibility note (operator-provided confirmation in AO Discord thread):
  - Non-mining Arweave node was confirmed as acceptable for the current HB alpha qualification path.

Reference operator profile selected for start:
- CPU: Ryzen 5 3600
- RAM: 64 GB
- Storage: 2x480 GB NVMe
- Network: 1 Gbps (EU region)

## Trust model lock (must remain true)

Even when we run our own HB node, runtime trust policy remains:
- HB/gateway operator is treated as an untrusted boundary for admin/site secrets.
- Site worker signatures remain authoritative for write intent.
- AO registry/runtime pointers remain source-of-truth for site/process routing.
- Gateway/HB cache is performance-only, never an authority plane.

This preserves compatibility with multi-operator future deployment where third-party HB runners can participate without gaining secret authority.

---

## Open participation policy (subsidized/project operation)

To keep the ecosystem fair during subsidized/early operation, we do **not** hard-block external HB operators by default.

Accepted model for current phase:
- Keep project-run HB nodes as **preferred** targets (better predictability/SLA), but not exclusive.
- Keep an optional fallback lane for external/public HB nodes (opt-in test mode, controlled rollout).
- Do not introduce a resolver rule that globally denies third-party nodes only because they are outside our pool.
- Security remains unchanged: write authority still comes from site-worker signatures and AO policy checks, not from HB trust.

Non-disruptive controls we can add now (without harming others):
- Weighted preference (soft routing) instead of blacklist-only routing.
- Health/latency scoring per node with automatic temporary downgrade, not permanent ban.
- Abuse controls on our own edge (rate limits, bot filtering, request shaping) so attack traffic does not impact honest operators.

---

## Resolver flow notes (domain -> gateway/HB)

Reference flow for production-like routing:

1. User requests `https://<site-domain>`.
2. Cloudflare edge receives request and executes resolver logic (routing worker/service).
3. Resolver validates host + extracts `site_id` mapping (via AO public registry read path, cached at edge).
4. Resolver computes candidate HB list:
   - preferred project pool,
   - optional external fallback pool.
5. Resolver selects target using health + latency + saturation score (soft preference, not hard exclusion).
6. Resolver returns redirect/proxy decision and sets short-lived sticky token (host+target binding) to reduce re-resolution churn.
7. Selected HB serves front-controller flow:
   - reads AO runtime/site config (authority source),
   - uses local cache only as performance layer,
   - renders/serves requested page route.
8. Write or sensitive actions:
   - gateway/HB forwards signed intent,
   - worker signature + AO policy are validated,
   - untrusted gateway cannot escalate authority.

Failure behavior:
- If selected HB is degraded, resolver re-picks another candidate and rotates sticky binding.
- If AO read path is unhealthy, fail closed for sensitive paths and return controlled degraded response for read-only pages.

## Bootstrap/hardening command records

For exact reproducible VPS hardening commands used in the first Ubuntu 24.04 run, see:

- `ops/live-vps/HARDENING_COMMAND_LOG_2026-04-20.md`

## Access incident note (2026-04-20/21)

- During VPS hardening, we hit an operator lockout sequence:
  - public SSH was closed before the Tailscale+UFW path was fully verified,
  - recovery sessions caused temporary auth/firewall drift.
- We documented a deterministic emergency recovery path (GRUB `init=/bin/bash`, temporary SSH restore, then hardening rollback) in:
  - `ops/live-vps/HARDENING_COMMAND_LOG_2026-04-20.md` (`13) Emergency access path` and `14) Incident follow-up checklist`).
- Current policy reminder for this run:
  - keep firewall disabled only until remote management path is confirmed stable again,
  - then re-enable with Tailscale-only SSH ingress and remove temporary recovery files.

## Incident closure update (2026-04-21)

- Firewall was re-enabled with Tailscale-only SSH ingress:
  - allow `22/tcp` only on `tailscale0`,
  - allow `41641/udp` for tailscale transport.
- Root access policy restored:
  - `root` locked,
  - SSH password auth disabled,
  - `PermitRootLogin no`.
- Reboot drill passed:
  - node returned in ~80s,
  - `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node` all recovered automatically.

Detailed command trail and verification outputs:
- `ops/live-vps/HARDENING_COMMAND_LOG_2026-04-20.md` (sections 15 and 16).

## Ops update (2026-04-21)

- `hyperbeam.<your-domain>` remains routed through cloudflared.
- To improve default operator UX (without changing stock HyperBEAM code), hostname now uses a local loopback proxy:
  - root path returns redirect to HyperBEAM meta page (`/~meta@1.0/info`),
  - remaining paths proxy to HyperBEAM origin.
- Added recurring VPS health checks via systemd timer (`darkmesh-healthcheck.timer`, every 5 minutes) covering:
  - runtime services (`tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node`),
  - local/public Arweave `/info`,
  - HyperBEAM public hostname endpoints,
  - disk usage guardrails.

## Ops update 2 (2026-04-21)

- Config backup automation is now closed and verified:
  - `darkmesh-config-backup.timer` active (daily, persistent),
  - latest archive checksum verified (`sha256sum -c`),
  - archive content validated (`tar -tf`) against expected runtime config set.
- Current runtime baseline (post-incident + post-reboot):
  - `root` locked,
  - key-only SSH policy active,
  - UFW allows only `tailscale0:22/tcp` + `41641/udp`,
  - `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node` all active.
- Public endpoint checks in the same run:
  - `https://hyperbeam.<your-domain>` -> `302`,
  - `https://hyperbeam.<your-domain>/~meta@1.0/info` -> `200`,
  - `https://arweave.<your-domain>/info` -> `200`.

## Ops update 3 (2026-04-21)

- Fixed alert webhook payload bug in live script:
  - `darkmesh-health-alert.sh` now builds jq payload correctly when `WEBHOOK_URL` is set.
- Synced `ops/live-vps/runtime/` templates to current live VPS baseline (important for deterministic rebuild):
  - healthcheck + alert units/scripts,
  - config-backup units/script,
  - nginx loopback template,
  - `restore.sh` install/enable flow.

## Ops update 4 (2026-04-21)

- Added weekly local restore-integrity drill automation for config backups:
  - `darkmesh-config-verify.service`
  - `darkmesh-config-verify.timer`
- Verification behavior:
  - finds latest config archive,
  - verifies `.sha256`,
  - extracts to temp path,
  - checks required files are present.
- First manual run completed successfully (`VERIFY PASS`), timer enabled.

## Ops update 5 (2026-04-21)

- Offsite backup layer is staged (not yet armed):
  - `restic` installed on VPS,
  - offsite backup units/scripts/templates synced,
  - `/etc/darkmesh/backup.env` created as root-only template.
- `darkmesh-backup.timer` intentionally stays disabled until repository credentials are set.
- `darkmesh-backup.service` preflight now fails in the expected way when credentials are missing (`RESTIC_REPOSITORY is required`), not due to unit namespace setup.

## Ops update 6 (2026-04-21)

- Activated explicit free-backup mode:
  - keep local timers active (`config-backup`, `config-verify`, `config-prune`),
  - keep paid offsite timer disabled (`darkmesh-backup.timer`).
- Added local pull helper to move verified backup snapshots from VPS to operator machine over Tailscale:
  - `ops/live-vps/local-tools/pull-latest-config-backup.sh`.

## Ops update 7 (2026-04-21)

- Rotated active wallet JSONs on VPS:
  - Arweave wallet key file (in-place),
  - HyperBEAM operator key (`/srv/darkmesh/hb/keys/hyperbeam-key.json`).
- New HB operator address after rotation:
  - `<HB_OPERATOR_ADDRESS>`
- Service health after restart remained OK (`arweave` + `hyperbeam` endpoints both `200`).
- First local Proton upload bundle prepared on desktop:
  - `DARKMESH_PROTON_UPLOAD_20260421T000156Z`

## NASA alpha burn-in checklist (24h, post-stake)

Scope:
- Goal: verify stable operation after stake/validation before stricter lock-down changes.
- Window: `T0 -> T+24h` (hourly checks, plus start/end snapshots).
- Required outcome: no sustained outage, no service restart loops, no endpoint instability.

### T0 snapshot (2026-04-21)

- Stake + validation: operator confirmed completed.
- Runtime status at start:
  - `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node` = `active`.
  - `https://hyperbeam.<your-domain>/` -> `302`
  - `https://hyperbeam.<your-domain>/~meta@1.0/info` -> `200`
  - `https://arweave.<your-domain>/info` -> `200`
  - local Arweave tip delta vs `arweave.net`: `1` block.
- HyperBEAM metrics endpoint responds:
  - `https://hyperbeam.<your-domain>/~hyperbuddy@1.0/metrics`
  - request counters incrementing (`cowboy_requests_total`, `event{topic="http",event="http_inbound"}`).

### Hourly operator run (copy/paste)

```bash
date -u
sudo /usr/local/sbin/darkmesh-healthcheck.sh
curl -sS https://arweave.<your-domain>/info | jq '{height,peers,queue_length,current}'
curl -sS https://arweave.net/info | jq '{height}'
curl -sS https://hyperbeam.<your-domain>/~hyperbuddy@1.0/metrics | grep -E 'cowboy_requests_total|http_inbound|returning_500_error' | head -n 20
systemctl --failed --no-legend --plain
```

### Pass/fail gates for end of window

Pass if all are true:
- No failed units in `systemctl --failed`.
- Healthcheck remains `HEALTHCHECK PASS`.
- Public endpoints stay at expected status (`302/200/200` as above).
- Arweave height keeps advancing and does not stall for prolonged periods.
- HyperBEAM metrics remain readable and inbound counters continue to move.
- No sustained error bursts in logs (short transient restart/network blips are acceptable).

Fail if any are true:
- Repeated healthcheck failures.
- Endpoint status drift (`>=5` consecutive failures in same path).
- Arweave stalled while peers reachable.
- Continuous 5xx growth with user-visible impact.

### If fail during burn-in

1. Capture evidence immediately:
   - `journalctl -u arweave-node -u cloudflared-tunnel --since "30 minutes ago" --no-pager`
   - `sudo docker logs --since 30m darkmesh-hyperbeam`
2. Hold further hardening changes (no new policy tightening).
3. Restore to last known-good runtime templates (`ops/live-vps/runtime/`) and re-check.
4. Restart burn-in timer from fresh healthy T0.

## Ops update 8 (2026-04-21)

- Added lightweight hourly metrics capture on live VPS (no Prometheus/Grafana dependency):
  - script: `/usr/local/sbin/darkmesh-metrics-snapshot.sh`
  - unit: `/etc/systemd/system/darkmesh-metrics-snapshot.service`
  - timer: `/etc/systemd/system/darkmesh-metrics-snapshot.timer`
- Output location:
  - `/srv/darkmesh/metrics/hourly-YYYYMMDD.jsonl`
- Snapshot fields include:
  - Arweave height/peers/queue + public endpoint status,
  - HyperBEAM root/meta endpoint status,
  - HyperBEAM request/error counters from `~hyperbuddy@1.0/metrics`,
  - host load + disk usage guardrails.
- Timer status:
  - `darkmesh-metrics-snapshot.timer` enabled and active (hourly, persistent).

## T+24h operator notes (what to decide after burn-in)

At `T0 + 24h`, run this decision gate before any tuning/migration changes:

1. Confirm stability baseline:
   - no failed units,
   - `darkmesh-healthcheck` stays `PASS`,
   - endpoint matrix still `302/200/200`.
2. Confirm contribution quality from hourly snapshots:
   - `hyperbeam.http_inbound` rising steadily (not flat),
   - `cowboy_server_error` and `http_500` slope low/stable,
   - no repeated long outage windows.
3. Validate Arweave side is not bottlenecked:
   - `height` continues increasing,
   - peers stable (`~140+` range),
   - no sustained queue growth.
4. If all green, proceed in this order:
   - switch AO/-write live endpoint config to the public EU HB path,
   - keep migration of gateway logic into AO processes (gateway as universal HB),
   - only then apply performance tuning batch (acceptors/connections/edge weighting).
