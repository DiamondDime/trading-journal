#!/usr/bin/env bash
# scripts/release.sh — cut a new desktop release.
#
# Usage:
#   scripts/release.sh                  # interactive: prompts for next version
#   scripts/release.sh 0.2.0            # non-interactive: explicit version
#   scripts/release.sh --dry-run 0.2.0  # print what would happen, change nothing
#
# What it does:
#   1. Reads current version from package.json
#   2. Validates the requested version (semver, must be > current)
#   3. Updates package.json
#   4. Commits with `chore: release v{X.Y.Z}`
#   5. Tags `v{X.Y.Z}`
#   6. Pushes branch + tag
#   7. Stops — GitHub Actions (`release-desktop.yml`) does the rest:
#      - Builds the .dmg on macOS-latest
#      - Uploads .dmg, .blockmap, and latest-mac.yml to the GH Release
#
# Safety:
#   - Fails if the working tree isn't clean
#   - Fails if you're not on `main`
#   - Fails if the tag already exists (locally or on the remote)
#   - Won't push to a remote that doesn't have `main` configured

set -euo pipefail

# ----------------------------------------------------------------------------
# CLI parsing
# ----------------------------------------------------------------------------
DRY_RUN=0
NEXT_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$NEXT_VERSION" ]]; then
        echo "Multiple version args provided: '$NEXT_VERSION' and '$1'" >&2
        exit 2
      fi
      NEXT_VERSION="$1"
      shift
      ;;
  esac
done

# ----------------------------------------------------------------------------
# Repo & env preflight
# ----------------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "Not inside a git repo." >&2
  exit 1
fi
cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  echo "No package.json at repo root: $REPO_ROOT" >&2
  exit 1
fi

CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Refusing to release: not on main (current: '${CURRENT_BRANCH:-detached}')." >&2
  echo "Switch with: git switch main" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to release: working tree is dirty. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

# Make sure we have the latest main from origin, so we don't try to push a tag
# on top of stale history.
echo "Fetching origin/main…"
git fetch origin main --tags

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main 2>/dev/null || true)"
if [[ -n "$REMOTE_HEAD" && "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "Refusing to release: local main is not up to date with origin/main." >&2
  echo "  local : $LOCAL_HEAD" >&2
  echo "  remote: $REMOTE_HEAD" >&2
  echo "Run: git pull --ff-only" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# Read current version, prompt if needed, validate
# ----------------------------------------------------------------------------
CURRENT_VERSION="$(node -p "require('./package.json').version")"
echo "Current version: $CURRENT_VERSION"

if [[ -z "$NEXT_VERSION" ]]; then
  read -r -p "Next version (e.g. 0.2.0): " NEXT_VERSION
fi

# Strip leading "v" if user typed it.
NEXT_VERSION="${NEXT_VERSION#v}"

if ! [[ "$NEXT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "Invalid semver: '$NEXT_VERSION'" >&2
  echo "Expected MAJOR.MINOR.PATCH (optionally -PRERELEASE)" >&2
  exit 2
fi

# Compare versions (simple lexical comparison after zero-padding each segment).
pad_version() {
  awk -F'[.-]' '{ printf "%05d%05d%05d\n", $1, $2, $3 }' <<<"$1"
}
CURR_PAD="$(pad_version "$CURRENT_VERSION")"
NEXT_PAD="$(pad_version "$NEXT_VERSION")"
if [[ "$NEXT_PAD" -le "$CURR_PAD" ]]; then
  echo "Refusing: '$NEXT_VERSION' is not greater than current '$CURRENT_VERSION'." >&2
  exit 2
fi

TAG="v$NEXT_VERSION"

# Block re-using a tag.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag '$TAG' already exists locally." >&2
  exit 1
fi
if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  echo "Tag '$TAG' already exists on origin." >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# Apply changes
# ----------------------------------------------------------------------------
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    eval "$@"
  fi
}

echo
echo "Will release: $CURRENT_VERSION → $NEXT_VERSION ($TAG)"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "(dry run — nothing will change)"
fi
echo

# Update package.json in place. We use Node to preserve formatting style.
update_package_json() {
  node - <<NODE
const fs = require('node:fs');
const path = 'package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = '$NEXT_VERSION';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
NODE
}

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] would set package.json version to $NEXT_VERSION"
else
  update_package_json
fi

run git add package.json
run git commit -m "'chore: release v$NEXT_VERSION'"
run git tag -a "$TAG" -m "'Release v$NEXT_VERSION'"
run git push origin main
run git push origin "$TAG"

echo
echo "Pushed $TAG → origin."
echo "GitHub Actions workflow 'release-desktop.yml' will build + publish the DMG."
echo "Track it: https://github.com/skywalqr/crypto-spread-journal/actions"
