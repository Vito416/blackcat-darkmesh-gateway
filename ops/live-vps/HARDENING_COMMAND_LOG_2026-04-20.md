# VPS hardening command log - 2026-04-20

Purpose: reproducible command trail for first bootstrap on fresh Ubuntu 24.04 VPS.

Scope:
- lock inbound access to Tailscale-only SSH,
- install Docker + cloudflared runtime base,
- create Cloudflare Tunnel for HB/Arweave hostnames,
- keep operator trust model (gateway/HB untrusted for secrets).

---

## 0) Initial access

Initial bootstrap was done via temporary root SSH on public IPv4, then hardened.

---

## 1) Base packages

```bash
apt-get update -y && apt-get install -y \
  curl ca-certificates gnupg ufw fail2ban unattended-upgrades
```

---

## 2) Tailscale install + join

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --accept-dns=false --accept-routes=false
```

Manual step:
- open login URL returned by `tailscale up`,
- approve node in Tailnet.

Validation:

```bash
tailscale status
tailscale ip -4
tailscale ip -6
```

Expected node (example):
- `<TAILNET_HOSTNAME>`

---

## 3) Admin user and SSH hardening

Create operator user:

```bash
adduser --disabled-password --gecos "" adminops
usermod -aG sudo adminops
usermod -aG docker adminops
```

SSHD hardening drop-in:

```bash
cat >/etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
LoginGraceTime 20
MaxAuthTries 3
AllowUsers adminops
EOF
sshd -t && systemctl restart ssh
```

Optional emergency bootstrap convenience (remove later if needed):

```bash
echo 'adminops ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-adminops-nopasswd
chmod 440 /etc/sudoers.d/90-adminops-nopasswd
visudo -cf /etc/sudoers.d/90-adminops-nopasswd
```

Lock root password after tailscale access validated:

```bash
passwd -l root
```

---

## 4) Firewall hardening (UFW)

Reset + default deny + Tailscale-only SSH:

```bash
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp comment 'tailscale ssh'
ufw --force enable
ufw status verbose
```

---

## 5) Auto security updates

```bash
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades
```

---

## 6) Sysctl hardening

```bash
cat >/etc/sysctl.d/99-blackcat-hardening.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF
sysctl --system
```

---

## 7) Fail2ban

```bash
cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd
```

---

## 8) Docker engine (+ compose plugin)

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version
```

Docker daemon hardening baseline:

```bash
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false,
  "icc": false
}
EOF
systemctl restart docker
```

---

## 9) Cloudflared install + tunnel setup

Install:

```bash
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update -y
apt-get install -y cloudflared
```

---

## 10) Tailscale post-reinstall hardening (safe sequence)

After lockout/reinstall incident, the stable sequence used:

1) Keep public root SSH open only during bootstrap.
2) Confirm `tailscale up --ssh` and ACL allow before cutting public SSH.
3) Move Tailscale runtime to least-privilege preferences.

Applied command:

```bash
tailscale set \
  --operator=adminops \
  --accept-dns=false \
  --accept-routes=false \
  --advertise-routes= \
  --advertise-exit-node=false \
  --exit-node= \
  --webclient=false \
  --ssh=true \
  --netfilter-mode=nodivert
```

Validation:

```bash
tailscale debug prefs
tailscale status
```

Expected hardening state:
- `OperatorUser: adminops`
- `CorpDNS: false`
- `RouteAll: false`
- `RunSSH: true`
- `RunWebClient: false`
- `NetfilterMode: 1` (`nodivert`)

---

## 11) Fresh clean-run completion snapshot (applied)

This section captures the **successful clean rerun** on the reinstalled VPS.

- Host: `<PUBLIC_VPS_IPV4>` (Ubuntu 24.04.4)
- Date: `2026-04-20` (late CET run)

### Applied runtime state

- Tailscale:
  - `RunSSH=true`
  - `OperatorUser=adminops`
  - `AdvertiseTags=["tag:darkmesh-vps"]`
  - Tailnet IP: `<TAILNET_IPV4>`
- Arweave data mount:
  - `/srv/darkmesh/arweave-data` mounted from second NVMe (`xfs`)
- Docker:
  - Installed from Ubuntu package repo (`docker.io` + `docker-compose-v2`)
  - Service enabled and active
- cloudflared:
  - Installed (`cloudflared 2026.3.0`)
  - Named tunnel service active under systemd

### HyperBEAM + Arweave (live values)

- Arweave service:
  - `arweave-node.service` active
  - local API healthy at `http://127.0.0.1:1984/info`
- HyperBEAM:
  - container name: `darkmesh-hyperbeam`
  - local endpoint: `http://127.0.0.1:8734` (baseline `404` on `/` expected)
  - persisted operator key at:
    - `/srv/darkmesh/hb/keys/hyperbeam-key.json`
- Operator address (from HB logs):
  - `<HB_OPERATOR_ADDRESS>`

### Cloudflare Tunnel (live values)

- Tunnel name: `darkmesh-gateway-vps`
- Tunnel ID: `<TUNNEL_UUID>`
- Credentials file:
  - `/root/.cloudflared/<TUNNEL_UUID>.json`
- Ingress hostnames:
  - `hyperbeam.<your-domain> -> http://127.0.0.1:8734`
  - `arweave.<your-domain> -> http://127.0.0.1:1984`
- External validation:
  - `https://arweave.<your-domain>/info` returns Arweave JSON
  - `https://hyperbeam.<your-domain>` returns HTTP `404` (expected baseline)

UFW tightened from "all tailscale0" to SSH-only over Tailscale:

```bash
ufw --force delete <rule allowing all on tailscale0>
ufw allow in on tailscale0 to any port 22 proto tcp comment 'tailscale ssh only'
```

---

## 11) Lock-first model for future config changes (no root password churn)

Goal:
- keep root password static/locked,
- avoid repeating lockout events during SSH/UFW/Tailscale edits.

Applied:

```bash
passwd -l root
passwd -l adminops
echo 'adminops ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-adminops-nopasswd
chmod 440 /etc/sudoers.d/90-adminops-nopasswd
visudo -cf /etc/sudoers.d/90-adminops-nopasswd
```

Operational model:
- local/VNC password login is disabled for both `root` and `adminops`,
- login only as `adminops` over Tailscale SSH,
- elevate via `sudo -i`,
- keep direct `root@` access disabled in Tailnet ACL policy except explicit break-glass windows.

Added helper on server:

```bash
/usr/local/sbin/darkmesh-arm-rollback
```

What it does:
- snapshots `/etc/ssh` and `/etc/ufw` to `/root/recovery-<timestamp>`,
- arms a 5-minute auto-rollback systemd timer (`darkmesh-rollback-<timestamp>`),
- rollback restores SSH/UFW snapshot, restarts SSH, disables UFW if needed.

Safe workflow for risky network/auth edits:

```bash
sudo -i
/usr/local/sbin/darkmesh-arm-rollback
# apply SSH/UFW/Tailscale changes
# validate from a second session
systemctl cancel darkmesh-rollback-<timestamp>
```

Login + tunnel (manual CF approval required on login URL):

```bash
cloudflared tunnel login
cloudflared tunnel create darkmesh-gateway
cloudflared tunnel route dns darkmesh-gateway hyperbeam.<your-domain>
cloudflared tunnel route dns darkmesh-gateway arweave.<your-domain>
```

Tunnel config:

```bash
install -d -m 0755 /etc/cloudflared
cat >/etc/cloudflared/config.yml <<'EOF'
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

originRequest:
  connectTimeout: 10s
  noTLSVerify: false

ingress:
  - hostname: hyperbeam.<your-domain>
    service: http://127.0.0.1:8734
  - hostname: arweave.<your-domain>
    service: http://127.0.0.1:1984
  - service: http_status:404
EOF
cloudflared tunnel ingress validate /etc/cloudflared/config.yml
```

Systemd service:

```bash
cat >/etc/systemd/system/cloudflared-tunnel.service <<'EOF'
[Unit]
Description=Cloudflare Tunnel (darkmesh-gateway)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/root/.cloudflared /etc/cloudflared /var/log

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now cloudflared-tunnel
systemctl status cloudflared-tunnel --no-pager
journalctl -u cloudflared-tunnel --no-pager -n 40
```

---

## 10) APT duplicate-source cleanup noted during bootstrap

On this host, duplicate apt targets appeared (legacy `/etc/apt/sources.list` + `ubuntu.sources`).

Applied:

```bash
mv /etc/apt/sources.list /etc/apt/sources.list.disabled-by-hardening
apt-get update -y
```

Keep this step only if duplicate warnings are observed.

---

## 11) Post-hardening checks

```bash
systemctl --no-pager --type=service --state=running | egrep 'tailscaled|docker|fail2ban|unattended|cloudflared'
ss -tulpen
curl -I https://hyperbeam.<your-domain>
curl -I https://arweave.<your-domain>
```

Expected before HB/Arweave services start:
- public HTTPS hostnames resolve,
- Cloudflare responds `502` (origin port not yet serving).

---

## Recreate notes

- Re-run in same order (Tailscale -> SSH/UFW hardening -> Docker -> cloudflared).
- Verify tailscale access before locking down root/password auth.
- Keep cloudflared creds (`/root/.cloudflared/*.json`) secret; rotate if leaked.
- After full stack is up, consider removing NOPASSWD sudo exception for `adminops`.

---

## 12) Applied bring-up continuation (Arweave + HB)

After hardening, these were executed on the same VPS:

```bash
# directories
sudo install -d -m 0755 /srv/darkmesh/{hb,arweave-data,releases}
sudo install -d -m 0755 /opt/arweave

# arweave install
cd /srv/darkmesh/releases
curl -fsSLO https://github.com/ArweaveTeam/arweave/releases/download/N.2.9.5.1/arweave-2.9.5.1.ubuntu24.x86_64.tar.gz
tar -xzf arweave-2.9.5.1.ubuntu24.x86_64.tar.gz -C /opt/arweave
ln -sfn /opt/arweave/arweave-2.9.5.1.ubuntu24.x86_64 /opt/arweave/current

# service start
systemctl daemon-reload
systemctl enable --now arweave-node

# hyperbeam bootstrap
cd /srv/darkmesh/hb
curl -fsSLo Dockerfile https://raw.githubusercontent.com/permaweb/HyperBEAM/feat/community-node/docs/community/Dockerfile
curl -fsSLo entrypoint.sh https://raw.githubusercontent.com/permaweb/HyperBEAM/feat/community-node/docs/community/entrypoint.sh
docker compose -f /srv/darkmesh/hb/docker-compose.yml up --build -d

# stability tweak
# changed AUTO_INDEX from true -> false in /srv/darkmesh/hb/docker-compose.yml
docker compose -f /srv/darkmesh/hb/docker-compose.yml up -d --force-recreate

# key persistence for stable operator identity
install -d -m 0700 /srv/darkmesh/hb/keys
docker cp darkmesh-hyperbeam:/app/hb/hyperbeam-key.json /srv/darkmesh/hb/keys/hyperbeam-key.json
chown root:root /srv/darkmesh/hb/keys/hyperbeam-key.json
chmod 600 /srv/darkmesh/hb/keys/hyperbeam-key.json
# mounted as read-only into /app/hb/hyperbeam-key.json in compose and recreated container
```

Observed state after this sequence:

- `arweave-node.service`: active/running and serving `/info`.
- `darkmesh-hyperbeam`: active/running (`8734/tcp`), baseline `404` at `/` expected.
- Public Cloudflare tunnel hostnames respond:
  - `https://arweave.<your-domain>/info`
  - `https://hyperbeam.<your-domain>`

Detailed reproducible bring-up is tracked in:
- `ops/live-vps/HB_ARWEAVE_BRINGUP_NEXT.md`

---

## 13) Emergency access path (lockout-safe, VNC only)

Use this only when SSH/Tailscale access is broken and you must recover access from console.

1) Boot through GRUB editor (not recovery shell):
- press `e` on normal Ubuntu entry,
- replace `ro` with `rw`,
- append `init=/bin/bash`,
- boot (`Ctrl+X` / `F10`).

2) Restore account access in single-user shell:

```bash
mount -o remount,rw /
passwd root
passwd adminops
passwd -u root
sync
reboot -f
```

3) Open temporary remote access (remove immediately after recovery):

```bash
cat >/etc/ssh/sshd_config.d/99-temp-recovery.conf <<'EOF'
PasswordAuthentication yes
PermitRootLogin yes
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
EOF
sshd -t && systemctl restart ssh
ufw allow 22/tcp
```

4) After remote access is restored, revert to hardened profile:

```bash
rm -f /etc/ssh/sshd_config.d/99-temp-recovery.conf
cat >/etc/ssh/sshd_config.d/70-darkmesh-auth.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
UsePAM yes
EOF
sshd -t && systemctl restart ssh
```

5) For current incident handling, firewall is intentionally disabled until access is stable:

```bash
ufw disable
systemctl disable --now ufw
```

Re-enable only after Tailscale SSH path is validated end-to-end.

---

## 14) Incident follow-up checklist (2026-04-20/21)

Root causes seen during this run:
- lockout sequence cut public SSH before Tailscale/UFW rule on `tailscale0` was confirmed active,
- repeated VNC/recovery operations introduced drift in auth/firewall state,
- in one phase, risky mdadm/partition operations were attempted from initramfs while recovering access.

Cleanup checklist (run when access is stable):

```bash
# auth state
passwd -S root
passwd -S adminops
ls -1 /etc/ssh/sshd_config.d/
sshd -t

# tailscale state
tailscale status
tailscale debug prefs | egrep 'RunSSH|OperatorUser|AdvertiseTags|RouteAll|CorpDNS'

# services
systemctl --no-pager --failed
systemctl status tailscaled --no-pager
systemctl status arweave-node --no-pager
docker ps

# storage sanity
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT
cat /proc/mdstat || true
```

If any temporary recovery file remains in `/etc/ssh/sshd_config.d/99-temp-*.conf`, remove it and reload sshd.

---

## 15) Incident closure snapshot (2026-04-21 00:28 CEST)

After recovery, firewall and auth baseline were re-applied and validated:

```bash
# ssh/auth cleanup
rm -f /etc/ssh/sshd_config.d/99-temp-recovery.conf /etc/ssh/sshd_config.d/99-temp-codex-repair.conf
# keep only hardened auth profile + key-only access
# effective:
#   PermitRootLogin no
#   PasswordAuthentication no
#   KbdInteractiveAuthentication no

# ufw baseline (re-enabled)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp comment 'tailscale ssh'
ufw allow 41641/udp comment 'tailscale wireguard'
ufw --force enable
systemctl enable --now ufw
```

Verified immediately after apply:
- `ufw status verbose` shows only `tailscale0:22/tcp` + `41641/udp` inbound.
- `tailscaled`, `arweave-node`, `cloudflared-tunnel` all active.
- `https://arweave.<your-domain>/info` healthy.

---

## 16) Reboot drill + post-incident audit (2026-04-21)

Executed controlled reboot drill after incident closure to verify persistence across restart.

### Reboot drill

Pre-reboot checks confirmed:
- `root` locked (`passwd -S root => L`)
- key-only SSH (`PasswordAuthentication no`, `PermitRootLogin no`)
- UFW active with only:
  - `22/tcp` on `tailscale0`
  - `41641/udp` for tailscale transport
- `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node` all active.

Reboot command:

```bash
sudo systemctl reboot
```

Observed:
- node rejoined and accepted SSH again in ~80s,
- all core services returned active.

### Post-reboot verification snapshot

- Local Arweave endpoint:
  - `curl http://127.0.0.1:1984/info` => `arweave.N.1`, release `89`
- Public Arweave tunnel:
  - `curl https://arweave.<your-domain>/info` => healthy response
- HyperBEAM public endpoint:
  - `https://hyperbeam.<your-domain>` returns `404` baseline (expected for root path)
- Public SSH port still blocked from internet; SSH available over Tailscale path.

### Remaining follow-up (from audit)

1) Add automated health checks/alerts:
- alert when `arweave-node` repeatedly restarts or `/info` is unavailable,
- alert when `cloudflared-tunnel` drops connections.

2) Schedule kernel maintenance:
- one package remains held back (`linux-image-generic`), update in planned window and run another reboot drill.

3) Keep emergency path tested:
- retain documented GRUB `init=/bin/bash` break-glass steps,
- re-test quarterly (or after major auth/network changes).

---

## 17) HyperBEAM hostname + health timer closure (2026-04-21)

Requested follow-up:
- keep `hyperbeam.<your-domain>` served via cloudflared and operator-friendly,
- add recurring health checks (service/tunnel/runtime).

### HyperBEAM hostname over cloudflared

Observed:
- direct HyperBEAM root currently returns `404` by design.

Applied:
- added local loopback nginx reverse-proxy (`127.0.0.1:8744`) for HyperBEAM hostname UX:
  - `/` -> `302 /~meta@1.0/info`
  - all other paths proxy to `http://127.0.0.1:8734`
- updated cloudflared ingress:
  - `hyperbeam.<your-domain> -> http://127.0.0.1:8744`
  - `arweave.<your-domain> -> http://127.0.0.1:1984`

Validation snapshot:
- `https://hyperbeam.<your-domain>` -> `302`
- `https://hyperbeam.<your-domain>/~meta@1.0/info` -> `200`
- `https://arweave.<your-domain>/info` -> `200`

### Recurring health checks (systemd timer)

Installed:
- script: `/usr/local/sbin/darkmesh-healthcheck.sh`
- unit: `/etc/systemd/system/darkmesh-healthcheck.service`
- timer: `/etc/systemd/system/darkmesh-healthcheck.timer`

Current timer policy:
- run at boot + every 5 minutes,
- checks:
  - `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node`,
  - local/public Arweave `/info`,
  - HyperBEAM hostname (`root` + `~meta` endpoints),
  - disk usage guardrails (`/` and `/srv/darkmesh/arweave-data`).

Status after fix:
- `darkmesh-healthcheck.timer` = `active`
- last run result = `success`

Note:
- first revision had a jq-expression quoting bug and was corrected on-host.

---

## 18) Config backup automation closure (2026-04-21)

Follow-up completed for the pending backup verification:

- backup script:
  - `/usr/local/sbin/darkmesh-backup-config.sh`
- units:
  - `/etc/systemd/system/darkmesh-config-backup.service`
  - `/etc/systemd/system/darkmesh-config-backup.timer`

Current timer policy:
- daily at `03:17` local time (`Persistent=true`).

Manual verification over Tailscale SSH:

```bash
latest=$(sudo bash -lc "ls -1t /srv/darkmesh/backups/config/darkmesh-config-*.tar.zst | head -n1")
echo "$latest"
sudo sha256sum -c "$latest.sha256"
sudo tar -tf "$latest" | sed -n '1,120p'
systemctl list-timers darkmesh-healthcheck.timer darkmesh-config-backup.timer --no-pager
```

Verification snapshot:
- latest archive:
  - `/srv/darkmesh/backups/config/darkmesh-config-20260420T230502Z.tar.zst`
- checksum:
  - `OK`
- archive content includes expected reproducible config set:
  - cloudflared ingress config/service,
  - healthcheck + alert units/scripts,
  - nginx loopback proxy config,
  - ssh hardening snippet,
  - ufw rules,
  - HyperBEAM docker compose file.
- timer state:
  - `darkmesh-config-backup.timer` active and waiting for next run.

Additional runtime audit snapshot (same session):
- auth:
  - `root` locked,
  - `adminops` locked (Tailscale SSH + sudo workflow).
- ssh policy (effective):
  - `PermitRootLogin no`
  - `PasswordAuthentication no`
  - `KbdInteractiveAuthentication no`
  - `PubkeyAuthentication yes`
- services active:
  - `tailscaled`, `ufw`, `docker`, `cloudflared-tunnel`, `arweave-node`.
- SSH listener model:
  - `ssh.socket` active (socket activation),
  - `ssh.service` inactive until connection (expected).
- public endpoints:
  - `HB_ROOT=302`
  - `HB_META=200`
  - `AR_PUB=200`
- public SSH reachability test from internet:
  - `PUBLIC_SSH=closed_or_filtered`

---

## 19) Alert hook payload fix + runtime template sync (2026-04-21)

Found and fixed a latent bug in alert webhook payload generation:
- file: `/usr/local/sbin/darkmesh-health-alert.sh`
- issue: invalid jq object constructor caused runtime failure when `WEBHOOK_URL` was set.
- fix: payload now uses explicit jq mapping:
  - `'{text:$text, unit:$unit, result:$result, state:$state, host:$host, tailscale_ip:$ts_ip, timestamp:$ts}'`

Validation:

```bash
sudo WEBHOOK_URL=https://example.invalid /usr/local/sbin/darkmesh-health-alert.sh darkmesh-healthcheck.service
```

Expected:
- script exits `0`,
- webhook send failure (DNS/network) is tolerated (`curl ... || true`),
- alert line is still logged to journald (`darkmesh-alert`).

Post-fix baseline re-check:
- `passwd -S root` -> `L`
- `passwd -S adminops` -> `L`
- UFW remains unchanged:
  - `22/tcp` only on `tailscale0`
  - `41641/udp` transport rule

Runtime template updates synced in repository (`ops/live-vps/runtime/`):
- added:
  - `scripts/darkmesh-health-alert.sh`
  - `scripts/darkmesh-backup-config.sh`
  - `systemd/darkmesh-healthcheck-alert@.service`
  - `systemd/darkmesh-config-backup.service`
  - `systemd/darkmesh-config-backup.timer`
  - `etc/darkmesh/alerts.env.example`
  - `nginx/hyperbeam-loopback.conf`
- updated:
  - `restore.sh` options and install set,
  - `arweave-node.service` template to match live host,
  - `darkmesh-healthcheck.*` templates to match live host behavior.

---

## 20) Local restore integrity drill automation (2026-04-21)

Added and validated weekly config backup integrity check on VPS:

- script:
  - `/usr/local/sbin/darkmesh-backup-verify.sh`
- unit/timer:
  - `/etc/systemd/system/darkmesh-config-verify.service`
  - `/etc/systemd/system/darkmesh-config-verify.timer`

Timer schedule:
- `OnCalendar=Sun *-*-* 04:20:00` (persistent).

Manual validation run:

```bash
sudo systemctl start darkmesh-config-verify.service
sudo journalctl -u darkmesh-config-verify.service -n 30 --no-pager
```

Result:
- `VERIFY PASS archive=/srv/darkmesh/backups/config/darkmesh-config-20260420T232849Z.tar.zst`
- timer enabled and next run scheduled.

---

## 21) Offsite backup stack staging (2026-04-21)

Prepared encrypted offsite backup path without enabling unattended runs yet.

Applied:
- installed `restic` on host:
  - `restic 0.16.4`
- synced latest `ops/live-vps/runtime/` templates to host via `restore.sh --apply --reload-systemd`
  (includes updated backup/healthcheck/verify units and scripts).
- staged offsite backup files:
  - `/etc/darkmesh/backup.include`
  - `/etc/darkmesh/backup.exclude`
  - `/etc/darkmesh/backup.env.example`
  - `/etc/darkmesh/backup.env` (created as root-only template, no live credentials).

Verification:
- `darkmesh-backup.timer` remains `disabled` (intentional until credentials are filled).
- `darkmesh-backup.service` now reaches expected preflight failure (`RESTIC_REPOSITORY is required`) when started without credentials.
  - previous namespace error was removed by updating unit to use `CacheDirectory=` and `StateDirectory=`.
- active timers stay:
  - `darkmesh-healthcheck.timer`
  - `darkmesh-config-backup.timer`
  - `darkmesh-config-verify.timer`
- security baseline unchanged:
  - `root` still locked,
  - UFW still allows only `tailscale0:22/tcp` + `41641/udp`.

---

## 22) Free backup mode activation (2026-04-21)

User decision: stay in free mode (no paid provider credentials now).

Applied:
- enabled weekly retention prune automation:
  - script: `/usr/local/sbin/darkmesh-config-backup-prune.sh`
  - timer: `/etc/systemd/system/darkmesh-config-prune.timer`
  - schedule: weekly (`Sun 04:40`), default retention `120` days.
- manual smoke:
  - `systemctl start darkmesh-config-prune.service`
  - result: `PRUNE done count=0 retention_days=120`

Free offsite workflow helper added (local machine):
- `ops/live-vps/local-tools/pull-latest-config-backup.sh`
  - pulls latest archive over Tailscale SSH,
  - rewrites checksum file for local path,
  - verifies checksum locally.
- smoke run completed to local path:
  - `tmp/free-backup-pull-test`
  - checksum `OK`.

Prepared two-account local staging folders for manual free uploads:
- `tmp/proton-offsite-staging/account-a`
- `tmp/proton-offsite-staging/account-b`

Timer state snapshot:
- `darkmesh-healthcheck.timer` active
- `darkmesh-config-backup.timer` active
- `darkmesh-config-verify.timer` active
- `darkmesh-config-prune.timer` active
- `darkmesh-backup.timer` remains disabled (by policy in free mode).

---

## 23) Arweave wallet permissions re-validated (2026-04-21)

Found and corrected permission drift on Arweave wallet path:
- directory:
  - `/srv/darkmesh/arweave-data/wallets` -> `0700`
- key file:
  - `/srv/darkmesh/arweave-data/wallets/arweave_keyfile_*.json` -> `0600`

Validation snapshot:

```bash
drwx------ adminops adminops /srv/darkmesh/arweave-data/wallets
-rw------- adminops adminops /srv/darkmesh/arweave-data/wallets/arweave_keyfile_*.json
```

---

## 24) Wallet JSON rotation + first offsite pull (2026-04-21)

Requested action:
- rotate wallet JSON files to fresh keys,
- stage first backup artifacts to local desktop for Proton upload.

Rotation completed on VPS:
- Arweave wallet key file rotated in place:
  - `/srv/darkmesh/arweave-data/wallets/arweave_keyfile_*.json`
- HyperBEAM operator key rotated:
  - `/srv/darkmesh/hb/keys/hyperbeam-key.json`
- Previous keys archived (server-side, root-only):
  - `/srv/darkmesh/rotation/20260421T000156Z/`

New addresses:
- `ARWEAVE_ADDRESS=7ykYfsvAWn7ev7pVWRIbLvfl5M0CWXO1UpsJWIsTJkk`
- `HYPERBEAM_OPERATOR_ADDRESS=<HB_OPERATOR_ADDRESS>`

Post-rotation checks:
- restarted `arweave-node` and `darkmesh-hyperbeam`,
- local and public endpoints remained healthy:
  - `https://arweave.<your-domain>/info` -> `200`
  - `https://hyperbeam.<your-domain>/~meta@1.0/info` -> `200`

Local staging prepared for Proton upload:
- `/mnt/c/Users/jaine/Desktop/DARKMESH_PROTON_UPLOAD_20260421T000156Z`
  - `arweave-wallet-20260421T000156Z.json`
  - `hyperbeam-wallet-20260421T000156Z.json`
  - `darkmesh-config-20260420T232849Z.tar.zst`
  - checksum files (`.sha256`, `.local.sha256`)
  - `ROTATION_INFO.txt`
