#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${ROOT_DIR}/.." && pwd)}"

OUT_DIR="${1:-"${ROOT_DIR}/dist"}"
BUNDLE_NAME="${2:-blackcat-kernel-minimal-bundle}"

TEMPLATE_DIR="${ROOT_DIR}/templates/kernel-minimal"
DEST="${OUT_DIR}/${BUNDLE_NAME}"

CORE_DIR="${WORKSPACE_ROOT}/blackcat-core"
CONFIG_DIR="${WORKSPACE_ROOT}/blackcat-config"

echo "[build] template: ${TEMPLATE_DIR}"
echo "[build] output:   ${DEST}"
echo "[build] core:     ${CORE_DIR}"
echo "[build] config:   ${CONFIG_DIR}"

rm -rf "${DEST}"
mkdir -p "${DEST}"

# Copy template skeleton
cp -R "${TEMPLATE_DIR}/site" "${DEST}/site"
mkdir -p "${DEST}/.blackcat"

BLACKCAT_SKIP_VENDOR_BUILD="${BLACKCAT_SKIP_VENDOR_BUILD:-0}"
BLACKCAT_VENDOR_BUILDER="${BLACKCAT_VENDOR_BUILDER:-auto}" # auto|host|docker|skip

if [[ "${BLACKCAT_SKIP_VENDOR_BUILD}" == "1" ]]; then
  BLACKCAT_VENDOR_BUILDER="skip"
fi

if [[ "${BLACKCAT_VENDOR_BUILDER}" == "auto" ]]; then
  if command -v composer >/dev/null 2>&1; then
    BLACKCAT_VENDOR_BUILDER="host"
  elif command -v docker >/dev/null 2>&1; then
    BLACKCAT_VENDOR_BUILDER="docker"
  else
    BLACKCAT_VENDOR_BUILDER="none"
  fi
fi

if [[ "${BLACKCAT_VENDOR_BUILDER}" == "skip" ]]; then
  echo "[build] vendor build skipped (BLACKCAT_VENDOR_BUILDER=skip)."
  echo "[build] WARNING: The bundle will not boot without \`site/vendor/\`."
elif [[ "${BLACKCAT_VENDOR_BUILDER}" == "host" || "${BLACKCAT_VENDOR_BUILDER}" == "docker" ]]; then
  echo "[build] running composer install (no-dev) in a temp project (builder=${BLACKCAT_VENDOR_BUILDER})..."
  BUILD_DIR="$(mktemp -d)"
  trap 'rm -rf "${BUILD_DIR}"' EXIT

  CORE_PATH="${CORE_DIR}"
  CONFIG_PATH="${CONFIG_DIR}"
  DOCKER_WORKSPACE="/workspace"
  DOCKER_BUILD="/build"
  if [[ "${BLACKCAT_VENDOR_BUILDER}" == "docker" ]]; then
    CORE_PATH="${DOCKER_WORKSPACE}/blackcat-core"
    CONFIG_PATH="${DOCKER_WORKSPACE}/blackcat-config"
  fi

  cat > "${BUILD_DIR}/composer.json" <<JSON
{
  "name": "blackcatacademy/blackcat-kernel-minimal-bundle-build",
  "type": "project",
  "license": "proprietary",
  "require": {
    "blackcatacademy/blackcat-core": "dev-main",
    "blackcatacademy/blackcat-config": "dev-main"
  },
  "repositories": [
    { "type": "path", "url": "${CORE_PATH}", "options": { "symlink": false } },
    { "type": "path", "url": "${CONFIG_PATH}", "options": { "symlink": false } }
  ],
  "config": {
    "optimize-autoloader": true,
    "sort-packages": true
  },
  "minimum-stability": "dev",
  "prefer-stable": true
}
JSON

  if [[ "${BLACKCAT_VENDOR_BUILDER}" == "host" ]]; then
    (cd "${BUILD_DIR}" && composer install --no-dev --optimize-autoloader --classmap-authoritative)
  else
    if ! command -v docker >/dev/null 2>&1; then
      echo "[build] ERROR: docker not available, but BLACKCAT_VENDOR_BUILDER=docker."
      exit 2
    fi
    docker run --rm \
      -u "$(id -u):$(id -g)" \
      -v "${WORKSPACE_ROOT}:${DOCKER_WORKSPACE}:ro" \
      -v "${BUILD_DIR}:${DOCKER_BUILD}:rw" \
      -w "${DOCKER_BUILD}" \
      composer:2 \
      composer install --no-dev --optimize-autoloader --classmap-authoritative
  fi

  rm -rf "${DEST}/site/vendor"
  cp -R "${BUILD_DIR}/vendor" "${DEST}/site/vendor"
else
  echo "[build] ERROR: no vendor build path available."
  echo "[build] - Install composer locally, or"
  echo "[build] - Install docker locally, or"
  echo "[build] - Set BLACKCAT_VENDOR_BUILDER=skip (NOT recommended)."
  exit 2
fi

if command -v python3 >/dev/null 2>&1; then
  echo "[build] creating zip..."
  (cd "${OUT_DIR}" && python3 -m zipfile -c "${BUNDLE_NAME}.zip" "${BUNDLE_NAME}")
  echo "[build] zip: ${OUT_DIR}/${BUNDLE_NAME}.zip"
else
  echo "[build] python3 not found; skipping zip."
fi

echo "[build] done"
