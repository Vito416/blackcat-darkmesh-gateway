#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${ROOT_DIR}/.." && pwd)}"

say() { echo "[smoke] $*"; }

lint_with_php() {
  local file="$1"
  php -l "$file" >/dev/null
}

lint_with_docker_php() {
  local file="$1"
  local in_container="$file"
  if [[ "${file}" == "${WORKSPACE_ROOT}/"* ]]; then
    in_container="/workspace/${file#${WORKSPACE_ROOT}/}"
  fi
  docker run --rm -v "${WORKSPACE_ROOT}:/workspace" -w /workspace php:8.3-cli php -l "${in_container}" >/dev/null
}

php_lint() {
  local file="$1"
  if command -v php >/dev/null 2>&1; then
    lint_with_php "$file"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    lint_with_docker_php "$file"
    return
  fi
  echo "[smoke] ERROR: neither php nor docker is available to lint PHP files."
  exit 2
}

say "bash syntax"
bash -n "${ROOT_DIR}/scripts/build-kernel-minimal-bundle.sh"

say "php syntax (preflight + stage3 templates)"
php_lint "${ROOT_DIR}/tools/blackcat-preflight.php"
php_lint "${ROOT_DIR}/templates/kernel-minimal/site/public/index.php"
php_lint "${ROOT_DIR}/templates/kernel-minimal/site/_blackcat/setup.php"
php_lint "${ROOT_DIR}/templates/kernel-minimal/site/_blackcat/error-ui.php"

if [[ "${BLACKCAT_SMOKE_BUILD_BUNDLE:-1}" == "1" ]]; then
  say "build kernel-minimal bundle (vendor required)"
  BLACKCAT_VENDOR_BUILDER="${BLACKCAT_VENDOR_BUILDER:-docker}" \
    bash "${ROOT_DIR}/scripts/build-kernel-minimal-bundle.sh" >/dev/null

  if [[ ! -f "${ROOT_DIR}/dist/blackcat-kernel-minimal-bundle/site/vendor/autoload.php" ]]; then
    echo "[smoke] ERROR: bundle vendor/autoload.php missing after build."
    exit 2
  fi
  say "bundle vendor OK"
else
  say "bundle build skipped (BLACKCAT_SMOKE_BUILD_BUNDLE=0)"
fi

say "OK"
