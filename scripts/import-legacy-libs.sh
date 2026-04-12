#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Import selected legacy Blackcat repositories into
# gateway/kernel-migration/legacy-archive/snapshots
# as source snapshots for consolidation work.
#
# Intentionally excluded:
# - template assets (kept in dedicated blackcat-templates repo)
# - dependency trees (vendor/node_modules)
# - test artifacts and caches

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "$ROOT_DIR/.." && pwd)"
ARCHIVE_BASE="$ROOT_DIR/kernel-migration/legacy-archive"
DEST_BASE="$ARCHIVE_BASE/snapshots"
MANIFEST_PATH="$ARCHIVE_BASE/MANIFEST.md"

ALL_MODULES=(
  blackcat-analytics
  blackcat-auth
  blackcat-auth-js
  blackcat-config
  blackcat-core
  blackcat-crypto
  blackcat-crypto-js
  blackcat-gopay
  blackcat-installer
  blackcat-mailing
  blackcat-sessions
)

MODULE_FILTER=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  scripts/import-legacy-libs.sh [--module <name>] [--dry-run] [--help]

Options:
  --module <name>  Import only one legacy repo snapshot
  --dry-run        Show planned work without copying files or writing MANIFEST.md
  --help           Show this help
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'warn: %s\n' "$*" >&2
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

contains_module() {
  local needle="$1"
  local module
  for module in "${ALL_MODULES[@]}"; do
    if [[ "$module" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

is_git_repo() {
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

git_commit_ref() {
  git -C "$1" rev-parse --short=12 HEAD 2>/dev/null
}

render_manifest() {
  local imported_on="$1"
  shift
  local module_rows=("$@")

  {
    printf '# Legacy Import Manifest\n\n'
    printf 'Imported on (UTC): `%s`\n' "$imported_on"
    printf 'Importer: `scripts/import-legacy-libs.sh`\n'
    if [[ -n "$MODULE_FILTER" ]]; then
      printf 'Module filter: `%s`\n' "$MODULE_FILTER"
    else
      printf 'Module filter: `all`\n'
    fi
    printf '\n'
    printf '## Source snapshots\n\n'
    printf '| Module | Source commit |\n'
    printf '|---|---|\n'

    if (( ${#module_rows[@]} == 0 )); then
      printf '| _none_ | _n/a_ |\n'
    else
      printf '%s\n' "${module_rows[@]}" | sort | while IFS='|' read -r module commit; do
        printf '| `%s` | `%s` |\n' "$module" "$commit"
      done
    fi

    printf '\n## Included content classes\n\n'
    printf -- '- `README.md`, `LICENSE`, `NOTICE`\n'
    printf -- '- package/composer metadata (`package.json`, `composer.json`, lock files)\n'
    printf -- '- source directories (`src/`, `config/`, `docs/`, `bin/`, `scripts/`)\n'

    printf '\n## Excluded content classes\n\n'
    printf -- '- `.git`, `.github`\n'
    printf -- '- `vendor/`, `node_modules/`\n'
    printf -- '- tests and caches (`tests/`, `test/`, coverage, build outputs)\n'
    printf -- '- all `templates/` directories\n'
    printf '\nTemplate assets remain in dedicated repository: `blackcat-templates`.\n'
  } > "$MANIFEST_PATH"
}

module_rows=()
skipped_modules=()
selected_modules=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --module)
      [[ $# -ge 2 ]] || die "missing value for --module"
      MODULE_FILTER="$2"
      shift 2
      ;;
    --module=*)
      MODULE_FILTER="${1#--module=}"
      [[ -n "$MODULE_FILTER" ]] || die "missing value for --module"
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

if [[ -n "$MODULE_FILTER" ]]; then
  contains_module "$MODULE_FILTER" || die "unsupported module name: $MODULE_FILTER"
  selected_modules=("$MODULE_FILTER")
else
  selected_modules=("${ALL_MODULES[@]}")
fi

need_cmd git
need_cmd rsync

mkdir -p "$DEST_BASE"

for module in "${selected_modules[@]}"; do
  src="$WORKSPACE_DIR/$module"
  dest="$DEST_BASE/$module"

  if [[ ! -d "$src" ]]; then
    if [[ -n "$MODULE_FILTER" ]]; then
      die "missing source repo: $module (expected directory: $src)"
    fi
    warn "skipping missing source repo: $module (expected directory: $src)"
    skipped_modules+=("$module")
    continue
  fi

  if ! is_git_repo "$src"; then
    if [[ -n "$MODULE_FILTER" ]]; then
      die "source repo is not a git checkout: $module ($src)"
    fi
    warn "skipping non-git source repo: $module ($src)"
    skipped_modules+=("$module")
    continue
  fi

  commit_ref="$(git_commit_ref "$src")" || {
    if [[ -n "$MODULE_FILTER" ]]; then
      die "unable to resolve git commit for $module ($src)"
    fi
    warn "skipping repo with unresolved commit ref: $module ($src)"
    skipped_modules+=("$module")
    continue
  }

  module_rows+=("$module|$commit_ref")

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'dry-run: import %s from %s (commit %s) -> %s\n' "$module" "$src" "$commit_ref" "$dest"
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

  {
    printf 'module: %s\n' "$module"
    printf 'source_commit: %s\n' "$commit_ref"
    printf 'source_repo: %s\n' "$src"
  } > "$dest/.import-source"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'dry-run: would write manifest to %s\n' "$MANIFEST_PATH"
  printf 'dry-run: selected modules: %s\n' "${selected_modules[*]}"
  exit 0
fi

render_manifest "$(date -u +%F)" "${module_rows[@]}"

if (( ${#skipped_modules[@]} > 0 )); then
  {
    printf '\n## Skipped source repos\n\n'
    printf '%s\n' "${skipped_modules[@]}" | sort | while IFS= read -r module; do
      printf -- '- `%s`\n' "$module"
    done
  } >> "$MANIFEST_PATH"
fi

printf 'Imported legacy module snapshots into: %s\n' "$DEST_BASE"
printf 'Manifest updated: %s\n' "$MANIFEST_PATH"
