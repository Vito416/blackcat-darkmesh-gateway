# Demo domain E2E playbook (HyperBEAM-first)

Date: 2026-04-21

Goal: onboard multiple demo domains quickly, keep setup free-first, and verify that:

- domain -> HyperBEAM routing works,
- AO host lookup works (`site-by-host`),
- demo landing is rendered from project runtime.

## 1) Exact Cloudflare setup (per domain)

Use this baseline for **every** demo domain zone.

### Required DNS records

Set exactly these two records:

1. Record A
   - Type: `CNAME`
   - Name: `@`
   - Target: `hyperbeam.darkmesh.fun`
   - Proxy status: `Proxied` (orange cloud)
   - TTL: `Auto`

2. Record B
   - Type: `CNAME`
   - Name: `www`
   - Target: `@`
   - Proxy status: `Proxied` (orange cloud)
   - TTL: `Auto`

Notes:
- Cloudflare apex CNAME flattening is expected here.
- If `www -> @` is not accepted in your zone UI, use `www -> hyperbeam.darkmesh.fun`.

### Required TLS/edge settings

Set exactly:

- `SSL/TLS -> Overview -> Full (strict)`
- `SSL/TLS -> Edge Certificates -> Always Use HTTPS = ON`
- `SSL/TLS -> Edge Certificates -> Automatic HTTPS Rewrites = ON`

### Recommended (free-safe) edge hardening

- `Security -> WAF -> Managed rules = ON` (default managed set)
- `Caching -> Configuration -> Browser Cache TTL = Respect Existing Headers`

### Optional canonical redirect

If you want only apex in browser:

- Redirect Rule: `www.<domain>/*` -> `https://<domain>/$1` (301)

## 2) AO mapping needed for each domain

For each hostname used publicly (`domain.tld`, `www.domain.tld`) ensure AO registry has host binding:

- `Action=BindDomain`
- `Site-Id=<site-id>`
- `Host=<hostname>`

Read path validation uses:

- `POST /api/public/site-by-host` with `{ "host": "<hostname>" }`

### HyperBEAM-first control-plane send path

Use:

- primary endpoint: `https://hyperbeam.darkmesh.fun`
- fallback endpoints (verification / resilience): `https://push.forward.computer`, `https://push-1.forward.computer`

Use helper:

```bash
bash ops/live-vps/local-tools/registry-control-plane.sh \
  --pid <registry_pid> \
  --wallet <wallet_json_path> \
  --site-id site-jdwt \
  --hosts jdwt.fun,www.jdwt.fun
```

The helper automatically tries HyperBEAM first and only falls back when needed.

### Optional DNS ownership proof before bind

For controlled onboarding, verify DNS proof first:

```bash
bash ops/live-vps/local-tools/dns-proof-cli.sh generate \
  --domain jdwt.fun \
  --site-id site-jdwt \
  --owner <wallet_address>
```

Publish TXT in DNS, then verify:

```bash
bash ops/live-vps/local-tools/dns-proof-cli.sh verify \
  --domain jdwt.fun \
  --site-id site-jdwt \
  --owner <wallet_address> \
  --challenge <challenge_from_generate>
```

Spec reference: `ops/live-vps/DNS_PROOF_ONBOARDING_SPEC_V1.md`.

## 3) Deploy order (safe sequence)

1. Add DNS records in Cloudflare.
2. Wait until edge propagation finishes (usually short).
3. Bind hostnames in AO (`RegisterSite` + `BindDomain`) using `registry-control-plane.sh`.
4. Deploy/activate demo landing template for that `siteId`.
5. Run smoke checks (`demo-domain-smoke.sh`).

## 4) Smoke command

From repo root:

```bash
bash ops/live-vps/local-tools/demo-domain-smoke.sh \
  --domains-file ops/live-vps/local-tools/demo-domains.example.txt \
  --ao-base https://hyperbeam.darkmesh.fun \
  --expect-marker "served via hyperbeam.darkmesh.fun"
```

You can also pass domains directly:

```bash
bash ops/live-vps/local-tools/demo-domain-smoke.sh \
  --ao-base https://hyperbeam.darkmesh.fun \
  --expect-marker "served via hyperbeam.darkmesh.fun" \
  domain-one.tld domain-two.tld
```

## 5) What I need from you next (domain list format)

Send list in this format:

```text
example-one.tld,site-demo-001
example-two.tld,site-demo-002
```

If `www` should map to a different site than apex, send both explicitly.
