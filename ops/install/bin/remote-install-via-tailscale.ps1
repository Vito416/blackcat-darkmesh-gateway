param(
  [Parameter(Mandatory = $true)]
  [string]$Target,

  [string]$RepoUrl = "https://github.com/Vito416/blackcat-darkmesh-gateway.git",
  [string]$RepoRef = "feat/gateway-p2-1-hardening-batch",
  [string]$ServiceUser = "blackcat",
  [string]$InstallDir = "/opt/blackcat/gateway",
  [string]$DisableSshd = "1",
  [string]$AllowTailscaleSsh = "1",
  [string]$TunnelId = "",
  [string]$TunnelHostname = "",
  [string]$PublicUrl = ""
)

$remote = @"
set -euo pipefail
REPO_URL='$RepoUrl'
REPO_REF='$RepoRef'
SERVICE_USER='$ServiceUser'
INSTALL_DIR='$InstallDir'
DISABLE_SSHD='$DisableSshd'
ALLOW_TAILSCALE_SSH='$AllowTailscaleSsh'
TUNNEL_ID='$TunnelId'
TUNNEL_HOSTNAME='$TunnelHostname'
PUBLIC_URL='$PublicUrl'

if ! command -v sudo >/dev/null 2>&1; then
  apt-get update
  apt-get install -y sudo
fi

sudo mkdir -p /opt/blackcat

if [ ! -d "$InstallDir/.git" ]; then
  sudo git clone --branch "$RepoRef" --single-branch "$RepoUrl" "$InstallDir"
else
  sudo git -C "$InstallDir" fetch --all --tags --prune
  sudo git -C "$InstallDir" checkout "$RepoRef"
  sudo git -C "$InstallDir" pull --ff-only origin "$RepoRef"
fi

cd "$InstallDir"
sudo REPO_URL="$RepoUrl" REPO_REF="$RepoRef" SERVICE_USER="$ServiceUser" INSTALL_DIR="$InstallDir" \
  DISABLE_SSHD="$DisableSshd" ALLOW_TAILSCALE_SSH="$AllowTailscaleSsh" TUNNEL_ID="$TunnelId" \
  TUNNEL_HOSTNAME="$TunnelHostname" PUBLIC_URL="$PublicUrl" \
  bash ops/install/bin/install-all.sh
"@

$remote | tailscale ssh $Target "bash -s"
