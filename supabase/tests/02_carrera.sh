#!/usr/bin/env bash
# Prueba guiada en BD: dos sesiones compiten por la MISMA cabina en el MISMO horario.
# Sesión 1 (gerencia) programa la pintura de OT-0004 y retiene la transacción 2 s.
# Sesión 2 (asesor) intenta la pintura de OT-0005 a la vez: espera, ve el conflicto
# que nombra el bloque ganador y no ocupa técnico, cabina ni bahía.
set -euo pipefail
DB=${DB:-tablero_test}
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
PRE="set client_min_messages = warning;
create function pg_temp.t(d int, h text) returns timestamptz language sql as \$\$
  select ((date_trunc('week', now() at time zone 'America/Mexico_City')::date + d) + h::time)::timestamp at time zone 'America/Mexico_City' \$\$;"
SQL_PINTURA() { # $1 folio  $2 técnico (los dos usan al pintor D: el conflicto es por la cabina)
  echo "select public.operar(gen_random_uuid(), 'programar_bloque', jsonb_build_object(
    'etapa_id', (select e.id from etapa e join orden o on o.id=e.orden_id where o.folio='$1' and e.tipo='pintura'),
    'tecnico_id', (select id from tecnico where nombre='Técnico $2'),
    'area_id', (select id from area where nombre='Cabina de pintura'),
    'inicio', pg_temp.t(3,'12:00')))->>'folio';"
}
antes=$($PSQL -tAc "select count(*) from bloque")
( $PSQL -tA <<SQL
$PRE
begin;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001"}',true);
\echo '[sesión 1] programando…'
$(SQL_PINTURA OT-0004 D)
select pg_sleep(2);
commit;
\echo '[sesión 1] commit'
SQL
) > /tmp/carrera1.log 2>&1 &
P1=$!
sleep 0.5
set +e
$PSQL -tA > /tmp/carrera2.log 2>&1 <<SQL
$PRE
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002"}',false);
\echo '[sesión 2] programando…'
$(SQL_PINTURA OT-0005 D)
SQL
R2=$?
set -e
wait $P1
cat /tmp/carrera1.log; cat /tmp/carrera2.log
despues=$($PSQL -tAc "select count(*) from bloque")
gano=$($PSQL -tAc "select b.folio from bloque b join etapa e on e.id=b.etapa_id join orden o on o.id=e.orden_id where o.folio='OT-0004' and e.tipo='pintura'")
perdio=$($PSQL -tAc "select count(*) from bloque b join etapa e on e.id=b.etapa_id join orden o on o.id=e.orden_id where o.folio='OT-0005' and e.tipo='pintura'")
[ "$R2" -ne 0 ] || { echo "FALLO: la sesión 2 no recibió conflicto"; exit 1; }
grep -q "No entra: Cabina de pintura está ocupada hasta las 14:00 del .* (bloque $gano" /tmp/carrera2.log || { echo "FALLO: el conflicto no nombra $gano"; exit 1; }
[ "$((despues - antes))" -eq 1 ] && [ "$perdio" -eq 0 ] || { echo "FALLO: escrituras inesperadas"; exit 1; }
echo "OK carrera: ganó $gano (sesión 1); la sesión 2 vio el conflicto y no ocupó recursos"
