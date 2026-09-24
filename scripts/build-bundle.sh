#!/usr/bin/env bash
# Build a ready-to-run bundle for hosts that cannot build Next.js themselves
# (e.g. glibc < 2.30, where the native SWC compiler cannot load).
#
# Run on a machine/CI with a recent Linux (glibc >= 2.30), Node 22 and network access:
#   bash scripts/build-bundle.sh            -> dist/pamper-app.tar.gz
# The bundle contains only committed files (never .env), the production build and
# production dependencies. The target host only runs it (no npm install, no build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)" # absolute: the script changes directory below
APP="$OUT/pamper-app"
rm -rf "$APP" "$OUT/pamper-app.tar.gz"
mkdir -p "$APP"

git -C "$ROOT" archive HEAD | tar -x -C "$APP"
cd "$APP"
export NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund
# Needed on the host to run database migrations and the account/key scripts.
npm install --no-save --no-audit --no-fund tsx dotenv
# The compiler is only used for building; it is the part that needs glibc >= 2.30.
rm -rf node_modules/@next/swc-* .next/cache tests
git -C "$ROOT" rev-parse --short HEAD > BUNDLE_VERSION

# Report the newest glibc symbol any remaining native module needs (target host must have it).
need="$(find node_modules -name '*.node' -o -name '*.so*' | grep -v musl | xargs -r objdump -T 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1 || true)"
echo "Native modules need at most: ${need:-unknown} (host: ldd --version)"

cd "$OUT"
tar -czf pamper-app.tar.gz pamper-app
echo "Bundle: $OUT/pamper-app.tar.gz ($(du -h pamper-app.tar.gz | cut -f1))"
