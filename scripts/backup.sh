#!/usr/bin/env bash
# Creates a compressed PostgreSQL backup of DATABASE_URL into ./backups (git-ignored).
# Backups contain sensitive data (salaries, customers): store them encrypted and off-site.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
mkdir -p backups
file="backups/pamper-$(date -u +%Y%m%d-%H%M).dump"
pg_dump --format=custom --no-owner --file="$file" "$DATABASE_URL"
chmod 600 "$file"
echo "Backup written to $file"
echo "Restore: pg_restore --clean --if-exists --no-owner -d \"\$DATABASE_URL\" $file"
