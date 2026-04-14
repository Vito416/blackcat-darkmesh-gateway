# Installer Scenarios

## A) Existing VPS already reachable over Tailscale

Use this when Debian is already installed and you can run `tailscale ssh`.

```bash
bash ops/install/bin/remote-install-via-tailscale.sh adminops@blackcat-gateway-vps
```

Then verify:

```bash
tailscale ssh adminops@blackcat-gateway-vps "systemctl status blackcat-gateway --no-pager"
tailscale ssh adminops@blackcat-gateway-vps "curl -fsS http://127.0.0.1:8080/healthz"
```

## B) Fresh VPS from ISO (minimal manual + automated rest)

1. Install Debian 12.
2. Install and auth Tailscale:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

3. From your local machine, run remote installer:

```bash
bash ops/install/bin/remote-install-via-tailscale.sh adminops@<tailscale-host>
```

4. Do Cloudflare tunnel login/create once on VPS:

```bash
tailscale ssh adminops@<tailscale-host> "sudo cloudflared tunnel login"
tailscale ssh adminops@<tailscale-host> "sudo cloudflared tunnel create blackcat-gateway"
tailscale ssh adminops@<tailscale-host> "sudo cloudflared tunnel route dns blackcat-gateway gateway.example.com"
```

5. Re-run installer with tunnel vars:

```bash
TUNNEL_ID=<uuid> TUNNEL_HOSTNAME=gateway.example.com \
  bash ops/install/bin/remote-install-via-tailscale.sh adminops@<tailscale-host>
```

## C) Team test machine

For collaborator testing use a temporary branch ref:

```bash
REPO_REF=feat/gateway-p2-1-hardening-batch \
  bash ops/install/bin/remote-install-via-tailscale.sh adminops@<tailscale-host>
```

This keeps onboarding reproducible without exposing public SSH.
