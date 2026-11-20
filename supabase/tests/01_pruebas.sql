-- =====================================================================
-- Pruebas de aceptación de la BD. Correr sobre una BD recién sembrada:
--   ./scripts/db-local.sh   (Postgres local con stub de Supabase)
-- Cada bloque DO falla con excepción si un criterio no se cumple.
-- =====================================================================
\set ON_ERROR_STOP 1

create or replace function pg_temp.como(p_email text) returns void language sql security definer as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.t(p_dia int, p_hora text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Mexico_City')::date + p_dia) + p_hora::time)::timestamp
         at time zone 'America/Mexico_City'
$$;
create or replace function pg_temp.oid(p_folio text) returns uuid language sql as $$ select id from public.orden where folio = p_folio $$;
create or replace function pg_temp.eid(p_folio text, p_tipo text, p_carga int default 1) returns uuid language sql as $$
  select e.id from public.etapa e join public.orden o on o.id = e.orden_id where o.folio = p_folio and e.tipo = p_tipo and e.carga = p_carga
$$;
create or replace function pg_temp.tid(p text) returns uuid language sql as $$ select id from public.tecnico where nombre = 'Técnico ' || p $$;
create or replace function pg_temp.aid(p text) returns uuid language sql as $$ select id from public.area where nombre = p $$;
create or replace function pg_temp.prog(p_folio text, p_tipo text, p_tec text, p_area text, p_dia int, p_hora text,
                                        p_margen int default 0, p_op uuid default gen_random_uuid()) returns jsonb
language sql as $$
  select public.operar(p_op, 'programar_bloque', jsonb_build_object(
    'etapa_id', pg_temp.eid(p_folio, p_tipo), 'tecnico_id', pg_temp.tid(p_tec), 'area_id', pg_temp.aid(p_area),
    'inicio', pg_temp.t(p_dia, p_hora), 'margen', p_margen))
$$;
-- Conteo global de filas escritas (como dueño, para no depender de la RLS del rol de prueba)
create or replace function pg_temp.conteo() returns bigint language sql security definer as $$
  select (select count(*) from public.bloque) + (select count(*) from public.pago) + (select count(*) from public.operacion)
       + (select count(*) from public.orden) + (select count(*) from public.liquidacion) + (select count(*) from public.refaccion)
$$;
-- Ejecuta SQL que DEBE fallar con un mensaje que contenga p_patron, y sin escrituras.
create or replace function pg_temp.debe_fallar(p_sql text, p_patron text) returns text language plpgsql as $$
declare v_msg text; v_antes bigint; v_despues bigint;
begin
  v_antes := pg_temp.conteo();
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then raise exception 'Se esperaba error «%» y no falló: %', p_patron, p_sql; end if;
  if v_msg not ilike '%' || p_patron || '%' then raise exception 'Error inesperado. Esperaba «%», llegó «%»', p_patron, v_msg; end if;
  v_despues := pg_temp.conteo();
  if v_antes <> v_despues then raise exception 'Hubo escrituras parciales tras el error: %', v_msg; end if;
  raise notice 'OK rechazo: %', v_msg;
  return v_msg;
end $$;

select pg_temp.como('gerencia@taller.test');

-- 1. Caso briefing ---------------------------------------------------
do $$ declare p public.presupuesto; begin
  select * into p from public.presupuesto where orden_id = pg_temp.oid('OT-0001');
  if p.total <> 9941.20 or p.anticipo <> 4970.60 or p.subtotal <> 8570 or p.iva <> 1371.20 then
    raise exception 'Briefing incorrecto: %', to_jsonb(p);
  end if;
  raise notice 'OK briefing: total % anticipo %', p.total, p.anticipo;
end $$;

-- 2. Sin anticipo no se programa; pago idempotente por op_id -----------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','E','Bahía 1',0,'15:00') $$, 'falta el anticipo del 50%');
do $$ declare r1 jsonb; r2 jsonb; op uuid := '99999999-0000-4000-8000-000000000001'; begin
  r1 := public.operar(op, 'registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 4970.60, 'concepto', 'Anticipo'));
  r2 := public.operar(op, 'registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 4970.60, 'concepto', 'Anticipo'));
  if (r2->>'repetida')::boolean is not true or r1->>'pago_id' <> r2->>'pago_id' then raise exception 'Pago no idempotente'; end if;
  if (select count(*) from public.pago where orden_id = pg_temp.oid('OT-0001')) <> 1 then raise exception 'Pago duplicado'; end if;
  if (r1->>'autorizada_para_programar')::boolean is not true then raise exception 'El anticipo no habilitó la programación'; end if;
  raise notice 'OK pago idempotente: %', r2;
end $$;
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 99999, 'concepto', 'Saldo')) $$, 'excede el saldo');
select pg_temp.debe_fallar($$ select public.operar('99999999-0000-4000-8000-000000000001', 'programar_bloque', '{}') $$, 'op_id ya se usó');

-- 3. Exclusión por recurso, inicio incluido / fin excluido, margen -----
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','E','Bahía 1',0,'09:30') $$, 'B-0001');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','A','Bahía 2',1,'09:00') $$, 'el técnico ya tiene el bloque B-0004');
do $$ declare r jsonb; begin
  r := pg_temp.prog('OT-0001','desarmado','E','Bahía 1',0,'15:00', 60);  -- arranca justo cuando termina B-0002
  raise notice 'OK fin excluido: % arranca 15:00 tras B-0002', r->>'folio';
end $$;
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'programar_mantenimiento', jsonb_build_object(
  'area_id', pg_temp.aid('Bahía 1'), 'inicio', pg_temp.t(0,'16:30'), 'fin', pg_temp.t(0,'17:00'))) $$, '+60 min de margen');

-- 4. Secuencia y especialidad -----------------------------------------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','hojalateria','A','Bahía 2',0,'14:00') $$, 'etapa anterior (Desarmado, bloque');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','hojalateria','C','Bahía 2',1,'11:00') $$, 'no tiene la especialidad');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','preparacion','C','Preparación',2,'11:00') $$, 'todavía no está programada');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','hojalateria','A','Cabina de pintura',1,'11:00') $$, 'no se puede hacer en');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','hojalateria','A','Bahía 2',1,'11:15') $$, 'bloque de 30 minutos');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','hojalateria','A','Bahía 2',1,'16:00') $$, 'no trabaja en ese horario');

-- 5. Cabina: máx 6 piezas por carga, horneado con técnico libre, curado 12 h
do $$ declare r jsonb; begin
  r := public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Prueba Cargas'), 'placa', 'CAR-007', 'tipo', 'Particular',
    'fecha_prometida', pg_temp.t(6, '12:00'),
    'piezas', (select jsonb_agg(jsonb_build_object('nombre', 'Pieza ' || g, 'dano', 'Leve')) from generate_series(1, 7) g)));
  if (select array_agg(piezas order by carga) from public.etapa where orden_id = (r->>'orden_id')::uuid and tipo = 'pintura') <> '{6,1}' then
    raise exception 'Cargas de cabina mal partidas';
  end if;
  raise notice 'OK 7 piezas → cargas de 6 + 1';
end $$;

do $$ declare r jsonb; o uuid; begin
  r := public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Prueba Horneado'), 'placa', 'HOR-001', 'tipo', 'Particular',
    'fecha_prometida', pg_temp.t(4, '18:00'), 'piezas', jsonb_build_array(jsonb_build_object('nombre', 'Toldo', 'dano', 'Leve'))));
  o := (r->>'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', o,
    'monto', (select anticipo from public.presupuesto where orden_id = o), 'concepto', 'Anticipo'));
  perform pg_temp.prog(r->>'folio', 'desarmado',   'A', 'Bahía 1',     1, '08:00');
  perform pg_temp.prog(r->>'folio', 'hojalateria', 'A', 'Bahía 1',     1, '10:30');
  -- Técnico D pinta OT-0003 de 12:00 a 13:00 y la cabina hornea hasta 14:00: D queda libre a las 13:00
  perform pg_temp.prog(r->>'folio', 'preparacion', 'D', 'Preparación', 1, '13:00');
  raise notice 'OK técnico libre durante horneado';
  perform set_config('test.folio_hor', r->>'folio', false);
end $$;
-- La cabina sigue ocupada por el horneado de B-0006 (13:00–14:00)
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'programar_mantenimiento', jsonb_build_object(
  'area_id', pg_temp.aid('Cabina de pintura'), 'inicio', pg_temp.t(1,'13:30'), 'fin', pg_temp.t(1,'14:00'))) $$, 'B-0006');
do $$ begin perform pg_temp.prog(current_setting('test.folio_hor'),'pintura','B','Cabina de pintura',1,'14:00'); raise notice 'OK cabina libre al terminar horneado'; end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.folio_hor'),'pulido','C','Pulido',1,'16:30') $$, 'Curado');
do $$ begin
  -- pintura 14:00–15:00 + 1 h horneado = 16:00 → +12 h calendario = 04:00 del miércoles (taller cerrado cuenta)
  perform pg_temp.prog(current_setting('test.folio_hor'),'pulido','C','Pulido',2,'08:30');
  raise notice 'OK curado nocturno respetado';
end $$;

-- 6. Armado bloqueado por refacciones; vuelve a En proceso ------------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0002','armado','A','Bahía 1',5,'08:00') $$, 'Armado bloqueado');
do $$ declare r jsonb; begin
  if (select estado from public.orden where folio = 'OT-0002') <> 'Esperando refacciones' then raise exception 'OT-0002 debería esperar refacciones'; end if;
  r := public.operar(gen_random_uuid(), 'recibir_refaccion', jsonb_build_object('refaccion_id',
         (select id from public.refaccion where orden_id = pg_temp.oid('OT-0002'))));
  if r->>'orden_estado' <> 'En proceso' or (select estado from public.etapa where id = pg_temp.eid('OT-0002','armado')) <> 'Pendiente' then
    raise exception 'No volvió a En proceso: %', r;
  end if;
  raise notice 'OK refacción recibida → %', r;
end $$;

-- 7. Aseguradora sin autorizar no se programa -------------------------
do $$ declare r jsonb; begin
  r := public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Prueba Aseguradora'), 'placa', 'ASG-100', 'tipo', 'Aseguradora',
    'aseguradora', 'Seguros Altavista', 'deducible', 2000, 'fecha_prometida', pg_temp.t(5, '12:00'),
    'piezas', jsonb_build_array(jsonb_build_object('nombre', 'Faro', 'dano', 'Reemplazo'))));
  perform set_config('test.folio_asg', r->>'folio', false);
end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.folio_asg'),'desarmado','E','Bahía 2',4,'08:00') $$, 'no está Autorizado');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object('cliente', jsonb_build_object('nombre','X'), 'placa','XXX-1', 'tipo','Particular', 'deducible', 100, 'fecha_prometida', now(), 'piezas', '[{"nombre":"a","dano":"Leve"}]')) $$, 'deducible solo aplica');

-- 8. Idempotencia de la asignación ------------------------------------
do $$ declare op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; n bigint; begin
  r1 := pg_temp.prog('OT-0001','hojalateria','A','Bahía 2',2,'11:00', 0, op);
  select count(*) into n from public.bloque;
  r2 := pg_temp.prog('OT-0001','hojalateria','A','Bahía 2',2,'11:00', 0, op);
  if r1->>'bloque_id' <> r2->>'bloque_id' or (select count(*) from public.bloque) <> n or (r2->>'repetida')::boolean is not true then
    raise exception 'Asignación no idempotente';
  end if;
  raise notice 'OK asignación idempotente (%)', r1->>'folio';
end $$;

-- 9. RLS ---------------------------------------------------------------
set role authenticated;
select pg_temp.como('tecnico.a@taller.test');
do $$ declare n int; begin
  if exists (select 1 from public.bloque where tecnico_id <> public.mi_tecnico_id()) then raise exception 'Técnico ve bloques ajenos'; end if;
  if (select count(*) from public.bloque) = 0 then raise exception 'Técnico no ve sus bloques'; end if;
  -- cambiar el id no devuelve filas ajenas: OT-0005 no tiene bloques de A
  select count(*) into n from public.orden where folio = 'OT-0005';
  if n <> 0 then raise exception 'Técnico ve una orden ajena'; end if;
  if exists (select 1 from public.etapa e where not public.es_orden_del_tecnico(e.orden_id)) then raise exception 'Técnico ve etapas ajenas'; end if;
  if (select count(*) from public.presupuesto) + (select count(*) from public.pago) + (select count(*) from public.refaccion)
     + (select count(*) from public.cliente) + (select count(*) from public.config) <> 0 then raise exception 'Técnico ve precios'; end if;
  if public.orden_finanzas((select id from public.orden limit 1)) is not null then raise exception 'Técnico ve finanzas'; end if;
  raise notice 'OK RLS técnico';
end $$;
select pg_temp.debe_fallar($$ select deducible from public.orden $$, 'permission denied');
select pg_temp.debe_fallar($$ select tarifa_hora from public.tecnico $$, 'permission denied');
select pg_temp.debe_fallar($$ insert into public.bloque (area_id, inicio, fin, tipo) values (pg_temp.aid('Pulido'), now(), now() + interval '1h', 'mantenimiento') $$, 'permission denied');
select pg_temp.debe_fallar($$ update public.etapa set estado = 'Terminada' $$, 'permission denied');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0005','desarmado'), 'accion', 'iniciar')) $$, 'Etapa inexistente');

select pg_temp.como('asesor@taller.test');
do $$ begin
  if (select count(*) from public.config_finanzas) <> 0 then raise exception 'Asesor ve finanzas de configuración'; end if;
  if public.tecnicos_admin() <> '[]'::jsonb then raise exception 'Asesor ve tarifas de técnicos'; end if;
  if exists (select 1 from jsonb_array_elements(public.refacciones_listado()) x where x ? 'costo' or x ? 'margen') then raise exception 'Asesor ve costos'; end if;
  if (public.orden_finanzas(pg_temp.oid('OT-0002'))->'refacciones'->0) ? 'costo' then raise exception 'Asesor ve costo en finanzas'; end if;
  if (select count(*) from public.liquidacion_detalle) <> 0 or public.panel_gerencia(current_date) is not null then raise exception 'Asesor ve márgenes'; end if;
  if (select count(*) from public.orden) = 0 then raise exception 'Asesor no ve órdenes'; end if;
  raise notice 'OK RLS asesor';
end $$;
select pg_temp.debe_fallar($$ select costo from public.refaccion $$, 'permission denied');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'guardar_config', '{"config":{"tarifa_mo":1}}') $$, 'Solo gerencia');

select pg_temp.como('gerencia@taller.test');
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.refacciones_listado()) x where x ? 'costo') then raise exception 'Gerencia no ve costos'; end if;
  if jsonb_array_length(public.tecnicos_admin()) <> 5 then raise exception 'Gerencia no ve técnicos'; end if;
  raise notice 'OK gerencia ve costos';
end $$;
reset role;

set role anon;
select pg_temp.debe_fallar($$ select folio from public.orden $$, 'permission denied');
do $$ declare r jsonb; begin
  r := public.consulta_publica('ot-0001', 'pzk 482-b');
  if r is null or r->>'folio' <> 'OT-0001' or (r->>'saldo')::numeric <> 4970.60 then raise exception 'Consulta pública incorrecta: %', r; end if;
  if public.consulta_publica('OT-0001', 'MXR-219-C') is not null then raise exception 'Consulta pública filtra folio ajeno'; end if;
  if public.consulta_publica('OT-0002', 'PZK-482-B') is not null then raise exception 'Consulta pública filtra folio ajeno'; end if;
  raise notice 'OK consulta pública: %', r;
end $$;
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'registrar_pago', '{}') $$, 'permission denied');
reset role;

-- 10. Atraso -----------------------------------------------------------
do $$ begin
  if not (select atrasada from public.v_orden_lista where folio = 'OT-0003') then raise exception 'OT-0003 debería estar atrasada'; end if;
  if not exists (select 1 from public.v_planificador where orden_folio = 'OT-0003' and atrasada) then raise exception 'Atraso no marcado en planificador'; end if;
  perform pg_temp.como('gerencia@taller.test');
  if not exists (select 1 from jsonb_array_elements(public.panel_gerencia(public._semana_de(now()))->'atrasos') x where x->>'folio' = 'OT-0003') then
    raise exception 'Atraso no marcado en panel';
  end if;
  raise notice 'OK atraso marcado';
end $$;

-- 11. Técnico: avance y liquidación ------------------------------------
set role authenticated;
select pg_temp.como('tecnico.b@taller.test');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0002','hojalateria'), 'accion', 'iniciar')) $$, 'Primero tiene que terminarse');
select pg_temp.como('tecnico.a@taller.test');
do $$ declare r jsonb; begin
  r := public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0002','desarmado'), 'accion', 'iniciar'));
  if r->>'estado' <> 'En curso' then raise exception 'No inició: %', r; end if;
  raise notice 'OK técnico inicia';
end $$;
reset role;
select pg_temp.como('gerencia@taller.test');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now()))) $$, 'En curso');
set role authenticated;
select pg_temp.como('tecnico.a@taller.test');
do $$ begin
  perform public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0002','desarmado'), 'accion', 'terminar'));
end $$;
reset role;
select pg_temp.como('gerencia@taller.test');
do $$ declare l jsonb; op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; fila jsonb; begin
  perform public.operar(gen_random_uuid(), 'guardar_config', '{"finanzas":{"umbral_bono_horas":1}}');
  l := public.liquidacion_semana(public._semana_de(now()));
  select x into fila from jsonb_array_elements(l->'filas') x where x->>'tecnico_nombre' = 'Técnico A';
  -- A vendió 2 h (desarmado OT-0002): base 2×120 = 240, bono (2−1)×60 = 60
  if (fila->>'horas_vendidas')::numeric <> 2 or (fila->>'bono')::numeric <> 60 or (fila->>'total')::numeric <> 300 then
    raise exception 'Liquidación mal calculada: %', fila;
  end if;
  r1 := public.operar(op, 'cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now())));
  r2 := public.operar(op, 'cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now())));
  if (r2->>'repetida')::boolean is not true or r1->>'liquidacion_id' <> r2->>'liquidacion_id' then raise exception 'Cierre no idempotente'; end if;
  perform public.operar(gen_random_uuid(), 'guardar_config', '{"finanzas":{"umbral_bono_horas":30}}');
  if (public.liquidacion_semana(public._semana_de(now()))->>'estado') <> 'Cerrada' then raise exception 'No quedó cerrada'; end if;
  raise notice 'OK liquidación cerrada: %', r1;
end $$;
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now()))) $$, 'ya está cerrada');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','preparacion','C','Preparación',5,'08:00') $$, 'liquidada');
select pg_temp.debe_fallar($$ update public.liquidacion_detalle set bono = 0 $$, 'solo lectura');

\echo '=== Todas las pruebas SQL pasaron ==='
