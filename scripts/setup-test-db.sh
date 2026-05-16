#!/usr/bin/env bash
# Bootstraps a fresh `crypto_spread_journal_test` Postgres database with the
# project's migrations applied. Idempotent — safe to run repeatedly.
#
# Usage:
#   ./scripts/setup-test-db.sh
#   TEST_DB=crypto_spread_journal_test ./scripts/setup-test-db.sh
#
# Driven by vitest before the integration suite runs.
set -euo pipefail

DB_NAME="${TEST_DB:-crypto_spread_journal_test}"
MIGRATION_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"

# Drop + recreate keeps the schema honest. Tests truncate user rows between
# cases so the schema itself stays stable inside a single run.
dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
createdb "$DB_NAME"

shopt -s nullglob
for f in "$MIGRATION_DIR"/*.sql; do
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
shopt -u nullglob

echo "[test-db] migrated $(ls "$MIGRATION_DIR" | wc -l | tr -d ' ') migrations into $DB_NAME"
