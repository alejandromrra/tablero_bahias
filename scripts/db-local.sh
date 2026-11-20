#!/usr/bin/env bash
# Crea una BD local con stub de Supabase + migraciones + semilla y corre las pruebas.
# Requiere psql contra un Postgres ≥ 15 local (variables PGHOST/PGUSER/PGPASSWORD si hace falta).
set -euo pipefail
cd "$(dirname "$0")/.."
export DB=${DB:-tablero_test}
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
reset_db() {
  $PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>/dev/null
  $PSQL -d "$DB" -f supabase/tests/00_stub_supabase.sql
  for f in supabase/migrations/*.sql; do $PSQL -d "$DB" -f "$f"; done
  $PSQL -d "$DB" -f supabase/seed.sql
}
reset_db
$PSQL -d "$DB" -f supabase/tests/01_pruebas.sql -o /dev/null 2>&1 | sed 's/^psql:[^ ]* //'
reset_db
./supabase/tests/02_carrera.sh
echo "OK: pruebas SQL superadas"
