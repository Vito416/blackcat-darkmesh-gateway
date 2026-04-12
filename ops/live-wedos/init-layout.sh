#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <target_dir>"
  echo "Example: $0 /www/gateway"
  exit 64
fi

TARGET_DIR="$1"

mkdir -p "$TARGET_DIR"/{dist,config,ops,logs,tmp}

echo "Created layout under: $TARGET_DIR"
echo "- $TARGET_DIR/dist"
echo "- $TARGET_DIR/config"
echo "- $TARGET_DIR/ops"
echo "- $TARGET_DIR/logs"
echo "- $TARGET_DIR/tmp"

echo
echo "Next steps:"
echo "1) Upload build artifacts to $TARGET_DIR/dist"
echo "2) Copy config/example.env -> $TARGET_DIR/config/.env and fill production values"
echo "3) Copy template map examples and replace placeholders"
echo "4) Run strict ops preflight on the host"
