#!/usr/bin/env bash
set -euo pipefail

# Import selected legacy Blackcat repositories into gateway/libs/legacy
# as source snapshots for consolidation work.
#
# Intentionally excluded:
# - template assets (kept in dedicated blackcat-templates repo)
# - dependency trees (vendor/node_modules)
# - test artifacts and caches

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "$ROOT_DIR/.." && pwd)"
DEST_BASE="$ROOT_DIR/libs/legacy"

modules=(
  blackcat-analytics
  blackcat-auth
  blackcat-auth-js
  blackcat-config
  blackcat-core
  blackcat-crypto
  blackcat-crypto-js
  blackcat-gopay
  blackcat-mailing
  blackcat-sessions
  blackcat-installer
)

mkdir -p "$DEST_BASE"

for module in "${modules[@]}"; do
  src="$WORKSPACE_DIR/$module"
  dest="$DEST_BASE/$module"
  if [[ ! -d "$src" ]]; then
    echo "skip (missing): $module"
    continue
  fi

  mkdir -p "$dest"

  rsync -a --delete --prune-empty-dirs \
    --exclude '.git/' \
    --exclude '.github/' \
    --exclude 'node_modules/' \
    --exclude 'vendor/' \
    --exclude 'dist/' \
    --exclude 'out/' \
    --exclude '.turbo/' \
    --exclude '.wrangler/' \
    --exclude '.phpunit.result.cache' \
    --exclude 'coverage/' \
    --exclude 'var/' \
    --exclude 'tests/' \
    --exclude 'test/' \
    --exclude 'templates/' \
    --include '*/' \
    --include 'README.md' \
    --include 'LICENSE' \
    --include 'NOTICE' \
    --include 'composer.json' \
    --include 'composer.lock' \
    --include 'package.json' \
    --include 'package-lock.json' \
    --include 'tsconfig.json' \
    --include 'tsconfig.build.json' \
    --include 'blackcat-cli.json' \
    --include 'src/***' \
    --include 'config/***' \
    --include 'docs/***' \
    --include 'bin/***' \
    --include 'scripts/***' \
    --exclude '*' \
    "$src/" "$dest/"

  printf '%s\n' "$module" > "$dest/.import-source"
done

echo "Imported legacy module snapshots into: $DEST_BASE"
