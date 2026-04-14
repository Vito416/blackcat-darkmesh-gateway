# Node-only VPS Installer (production-like)

This installer path is for the current gateway architecture:

- Node gateway runtime on VPS
- Cloudflare Tunnel as public entrypoint
- Tailscale admin path (no exposed public SSH)

It intentionally does **not** include legacy PHP bridge deployment.

## Minimum VPS profile

Start baseline:

- 2 vCPU threads
- 4 GB RAM
- 60 GB SSD
- Debian 12 (bookworm)

## What stays manual

Two steps are intentionally manual for security/account ownership:

1. Tailscale auth (`tailscale up` under your account)
2. Cloudflare tunnel auth + DNS binding:
   - `cloudflared tunnel login`
   - `cloudflared tunnel create blackcat-gateway`
   - `cloudflared tunnel route dns blackcat-gateway <gateway.domain.tld>`

After that, scripts can wire and run services automatically.

## Fast path

Run as root:

```bash
cd /opt/blackcat/gateway
bash ops/install/bin/install-all.sh
```

`install-all.sh` runs:

1. `00-bootstrap.sh` (packages + Node 20 + tailscale + cloudflared + service user)
2. `10-harden.sh` (sysctl + ufw fail-closed + sshd off by default)
3. `20-deploy-gateway.sh` (clone/update + `npm ci` + build + systemd)
4. `30-cloudflared.sh` (only if `TUNNEL_ID` and `TUNNEL_HOSTNAME` are set)
5. `40-verify.sh` (service + health + firewall checks)

## Environment and service files

- Gateway runtime template: `ops/install/env/gateway.env.example`
- Systemd template: `ops/install/systemd/blackcat-gateway.service`
- Runtime env target on host: `/etc/blackcat/gateway.env`

## Safety defaults

- Gateway binds to `127.0.0.1:8080`
- Public ingress goes only through `cloudflared`
- UFW default policy: deny incoming / allow outgoing
- SSH daemon is disabled by default (`DISABLE_SSHD=1`)

## Optional toggles

- Keep sshd enabled while onboarding:
  - `DISABLE_SSHD=0 bash ops/install/bin/10-harden.sh`
- Disable tailscale SSH port rule:
  - `ALLOW_TAILSCALE_SSH=0 bash ops/install/bin/10-harden.sh`

## Post-install checks

```bash
systemctl status blackcat-gateway --no-pager
systemctl status cloudflared --no-pager
curl -fsS http://127.0.0.1:8080/healthz
```

Optional public check:

```bash
PUBLIC_URL=https://gateway.example.com bash ops/install/bin/40-verify.sh
```
