# Cloudflare DNS + LB operator checklist (free-first)

Date: 2026-04-21  
Goal: keep one consistent process for:

- **A) free-first operation without Load Balancer** (default for most websites/ecommerce),
- **B) premium operation with Cloudflare Load Balancer** (critical domains).

---

## 0) Input values (before configuration)

Prepare:

- `PRIMARY_HB_ENDPOINT` (for example `hyperbeam.example.com`)
- `FALLBACK_HB_ENDPOINT` (secondary HB endpoint, if available)
- `SITE_DOMAIN` (for example `example.com`)
- `SITE_HOSTS` (`@`, `www`, and optional additional subdomains)
- policy mode: `default-no-lb` or `premium-lb`

---

## A) Default mode (without CF LB, free-first)

Use case: low-cost websites, standard availability, manual failover during incidents.

### A1. DNS records (Cloudflare Dashboard)

In zone `SITE_DOMAIN`:

1. **DNS -> Records -> Add record**
2. Type: `CNAME`
3. Name: `@` (and optionally `www`)
4. Target: `PRIMARY_HB_ENDPOINT`
5. Proxy status: `Proxied` (orange cloud)
6. TTL: `Auto`

Note: `www` can point to the same target, or be redirected to apex via Redirect Rule.

### A2. Edge baseline protection

In the zone:

- **SSL/TLS**: enable HTTPS-only mode according to project policy.
- **Security -> WAF**: enable managed baseline rules.
- **Caching**: keep conservative defaults (avoid aggressive caching for dynamic paths).

### A3. Smoke test after switch

- `https://SITE_DOMAIN/` returns 200/302 based on app flow.
- health endpoint (if present) responds.
- browser console check for mixed-content/CORS errors.

### A4. Incident runbook (manual failover)

If `PRIMARY_HB_ENDPOINT` fails:

1. Change CNAME target to `FALLBACK_HB_ENDPOINT`.
2. Verify `SITE_DOMAIN` availability from multiple locations.
3. After stabilization, decide whether to restore primary.

---

## B) Premium mode (with Cloudflare LB)

Use case: critical websites/ecommerce, higher availability, automatic failover.

### B1. Create LB pools

**Traffic -> Load Balancing -> Pools**

- Pool A: `HB_EU_1` -> origin `PRIMARY_HB_ENDPOINT`
- Pool B: `HB_EU_2` -> origin `FALLBACK_HB_ENDPOINT`
- (optional) Pool C: extra region/backup

### B2. Monitor/health check

Configure monitor:

- protocol: HTTPS
- path: `/~meta@1.0/info` or project health endpoint
- conservative timeout + interval (avoid flapping)
- accepted status codes: 2xx (optionally 3xx depending on flow)

### B3. Load balancer hostname

**Traffic -> Load Balancing -> Load balancers -> Create**

- Hostname: for example `lb.example.com`
- Default pool: `HB_EU_1`
- Fallback pool: `HB_EU_2`
- Steering: as planned (weighted/latency/least outstanding)
- Session affinity: enable if stable session routing is required

### B4. Domain wiring

In zone `SITE_DOMAIN`:

- CNAME `@`/`www` -> `lb.example.com` (proxied)

### B5. Failover drill

1. Simulate primary pool unavailability.
2. Verify traffic shifts to fallback.
3. Verify end-user domain stays functional.

---

## 1) Recommended rollout model

1. Start all new sites in **A (no-LB)** mode.
2. Measure traffic/incidents.
3. Switch only critical domains to **B (LB)** mode.

Low-cost stays the default, premium availability is an opt-in layer.

---

## 2) Definition of done

- DNS points according to selected mode.
- smoke test is green.
- failover/rollback runbook is clear.
- A/B decision is documented per domain (ops evidence).
