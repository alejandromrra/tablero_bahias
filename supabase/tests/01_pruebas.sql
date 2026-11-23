-- =====================================================================
-- Pruebas de aceptación de la BD (semana de la semilla: 0 = lunes). Correr sobre una BD recién sembrada:
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
create or replace function pg_temp.aid(p text) returns uuid language sql as $$
  select id from public.area where nombre = case p when 'E1' then 'Bahía de enderezado 1' when 'E2' then 'Bahía de enderezado 2'
    when 'PR' then 'Bahía de preparación' when 'CB' then 'Cabina de pintura' when 'AR' then 'Bahía de armado y pulido' else p end
$$;
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


create or replace function pg_temp.d(n int) returns text language sql as $$ select public._dia(pg_temp.t(n, '12:00')) $$;
create or replace function pg_temp.op(p_tipo text, p jsonb) returns jsonb language sql as $$ select public.operar(gen_random_uuid(), p_tipo, p) $$;
create or replace function pg_temp.nueva(p_placa text, p_piezas jsonb, p_pagar boolean default true) returns text language plpgsql as $$
declare r jsonb; o uuid;
begin
  r := pg_temp.op('crear_orden', jsonb_build_object('cliente', jsonb_build_object('nombre', 'Prueba ' || p_placa), 'placa', p_placa,
         'tipo', 'Particular', 'fecha_prometida', pg_temp.t(12, '18:00'), 'piezas', p_piezas));
  o := (r->>'orden_id')::uuid;
  perform pg_temp.op('emitir_presupuesto', jsonb_build_object('orden_id', o));
  if p_pagar then
    perform pg_temp.op('registrar_pago', jsonb_build_object('orden_id', o, 'monto', (select anticipo from public.presupuesto where orden_id = o), 'concepto', 'Anticipo'));
  end if;
  return r->>'folio';
end $$;
create or replace function pg_temp.accion(p_email text, p_folio text, p_tipo text, p_acc text) returns jsonb language plpgsql as $$
declare r jsonb; e uuid := pg_temp.eid(p_folio, p_tipo);
begin
  perform pg_temp.como(p_email);
  r := public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', e, 'accion', p_acc));
  perform pg_temp.como('gerencia@taller.test');
  return r;
end $$;

select pg_temp.como('gerencia@taller.test');

-- 1. Caso resuelto del encargo -----------------------------------------
do $$ declare p public.presupuesto; begin
  select * into p from public.presupuesto where orden_id = pg_temp.oid('OT-0001');
  if p.horas_vendidas <> 9 or p.mano_obra <> 4050 or p.materiales <> 1300 or p.refacciones <> 3220
     or p.subtotal <> 8570 or p.iva <> 1371.20 or p.total <> 9941.20 or p.anticipo <> 4970.60 then
    raise exception 'Caso resuelto incorrecto: %', to_jsonb(p);
  end if;
  raise notice 'OK caso resuelto: 9 h · total % · anticipo %', p.total, p.anticipo;
end $$;

-- 2. Habilitación por anticipo; pago idempotente -----------------------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','E','AR',1,'09:30') $$, 'no tiene el 50% de anticipo (pagado $ 0,00 de $ 4.970,60)');
do $$ declare r1 jsonb; r2 jsonb; op uuid := '99999999-0000-4000-8000-000000000001'; begin
  r1 := public.operar(op, 'registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 4970.60, 'concepto', 'Anticipo'));
  r2 := public.operar(op, 'registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 4970.60, 'concepto', 'Anticipo'));
  if (r2->>'repetida')::boolean is not true or r1->>'pago_id' <> r2->>'pago_id' then raise exception 'Pago no idempotente'; end if;
  if (select count(*) from public.pago where orden_id = pg_temp.oid('OT-0001')) <> 1 then raise exception 'Pago duplicado'; end if;
  if (select estado from public.orden where folio = 'OT-0001') <> 'Autorizada' then raise exception 'El anticipo no dejó la orden Autorizada'; end if;
  raise notice 'OK pago idempotente y orden Autorizada';
end $$;
select pg_temp.debe_fallar($$ select pg_temp.op('registrar_pago', jsonb_build_object('orden_id', pg_temp.oid('OT-0001'), 'monto', 99999, 'concepto', 'Saldo')) $$, 'supera el saldo');
select pg_temp.debe_fallar($$ select public.operar('99999999-0000-4000-8000-000000000001', 'programar_bloque', '{}') $$, 'op_id ya se usó');

-- 3. Exclusión por recurso con mensaje exacto ---------------------------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','E','AR',3,'09:00') $$,
  'No entra: Bahía de armado y pulido está llena hasta las 09:30 del ' || pg_temp.d(3) || ' (bloque B-0009');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','desarmado','E','AR',1,'09:00') $$,
  'No entra: Técnico E ya tiene un bloque el ' || pg_temp.d(1) || ' de 09:00 a 09:30 en Bahía de armado y pulido (bloque B-0004 · OT-0003 · Desarmado)');
do $$ declare r jsonb; begin
  r := pg_temp.prog('OT-0001','desarmado','E','AR',1,'09:30', 30);   -- arranca justo cuando termina B-0004 (fin excluido)
  raise notice 'OK fin excluido: % arranca 09:30', r->>'folio';
end $$;
select pg_temp.debe_fallar($$ select pg_temp.op('programar_mantenimiento', jsonb_build_object('area_id', pg_temp.aid('AR'),
  'inicio', pg_temp.t(1,'10:30'), 'fin', pg_temp.t(1,'11:00'))) $$, 'hasta las 11:00 del ' || pg_temp.d(1) || ' (bloque B-0022');

-- 4. Horario, secuencia, especialidad, ausencia, partición --------------
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','enderezado','A','E1',1,'10:00') $$, 'Desarmado termina el ' || pg_temp.d(1) || ' 10:30');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','enderezado','C','E1',2,'09:00') $$, 'no tiene la especialidad que pide Enderezado');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','preparacion','C','PR',2,'12:00') $$, 'la etapa anterior (Enderezado) todavía no está programada');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','enderezado','A','CB',2,'09:00') $$, 'Enderezado no se hace en Cabina de pintura');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','enderezado','A','E1',2,'09:15') $$, 'bloque de 30 minutos');
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','enderezado','A','E1',2,'14:30') $$, 'Fuera del horario del taller: el ' || pg_temp.d(2) || ' se atiende 09:00–14:00 y 16:00–18:00');
do $$ declare r jsonb; begin
  perform pg_temp.prog('OT-0001','enderezado','A','E1',2,'09:00');
  r := pg_temp.prog('OT-0001','preparacion','C','PR',2,'12:30');      -- 2,5 h: 12:30–14:00 + 16:00–17:00
  if (r->>'tramos')::int <> 2 or (select _hora(fin) from public.bloque where folio = r->'folios'->>1) <> '17:00' then
    raise exception 'La preparación no se partió en el corte de mediodía: %', r;
  end if;
  r := pg_temp.prog('OT-0001','pintura','D','CB',3,'13:00');          -- 1,5 h + 1 h horneado → termina jue 17:30
  if (select _fmt(max(fin)) from public.bloque where etapa_id = pg_temp.eid('OT-0001','pintura')) <> '' || pg_temp.d(3) || ' 17:30' then
    raise exception 'El horneado no termina el jueves 17:30: %', r;
  end if;
  raise notice 'OK etapas partidas en tramos: %', r->'folios';
end $$;

-- 5. Curado: horneado termina jue 17:30 → pulido no antes del vie 9:00 ---
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','pulido_armado','E','AR',3,'17:30') $$, 'No entra: el armado de OT-0001 espera 1 refacción');
do $$ begin perform pg_temp.op('recibir_refaccion', jsonb_build_object('refaccion_id', (select id from public.refaccion where orden_id = pg_temp.oid('OT-0001')))); end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','pulido_armado','E','AR',3,'17:30') $$, 'el pulido puede empezar desde el ' || pg_temp.d(4) || ' 09:00');
do $$ begin perform pg_temp.prog('OT-0001','pulido_armado','E','AR',4,'09:00'); raise notice 'OK pulido el viernes 9:00'; end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog('OT-0001','control_calidad','E','AR',4,'11:00') $$, 'no se programa');

-- Técnico B no trabaja sábados; la etapa sigue el próximo día hábil de B
do $$ declare f text; r jsonb; begin
  f := pg_temp.nueva('SAB-001', '[{"nombre":"Cofre","dano":"Fuerte"}]');
  perform pg_temp.prog(f,'desarmado','A','AR',4,'16:00');
  perform set_config('test.sab', f, false);
  r := pg_temp.prog(f,'enderezado','B','E2',4,'17:00');               -- 4 h: vie 17–18 + lun 9–12 (sábado salteado)
  if (select array_agg(_fmt(inicio) || '–' || _hora(fin) order by tramo) from public.bloque where etapa_id = pg_temp.eid(f,'enderezado'))
     <> array['' || pg_temp.d(4) || ' 17:00–18:00', '' || pg_temp.d(7) || ' 09:00–12:00'] then raise exception 'Partición incorrecta: %', r; end if;
  raise notice 'OK partición salta el sábado de B';
end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.sab'),'preparacion','D','PR',4,'11:00') $$, 'Enderezado termina');
do $$ declare f text; begin
  f := pg_temp.nueva('AUS-001', '[{"nombre":"Toldo","dano":"Leve"}]');
  perform set_config('test.aus', f, false);
  perform pg_temp.prog(f,'desarmado','A','AR',4,'09:00');
  perform pg_temp.prog(f,'enderezado','A','E1',4,'09:30');
end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.aus'),'preparacion','C','PR',4,'10:30') $$, 'Técnico C está ausente del ' || pg_temp.d(4) || ' 09:00 al ' || pg_temp.d(4) || ' 14:00 (Trámite personal)');
do $$ begin perform pg_temp.prog(current_setting('test.aus'),'preparacion','D','PR',4,'10:30'); raise notice 'OK otro técnico sin ausencia entra'; end $$;

-- 6. Cabina: cargas de hasta 6 piezas -----------------------------------
do $$ declare f text; begin
  f := pg_temp.nueva('CAR-007', (select jsonb_agg(jsonb_build_object('nombre', 'Pieza ' || g, 'dano', 'Leve')) from generate_series(1, 7) g), false);
  if (select array_agg(piezas order by carga) from public.etapa where orden_id = pg_temp.oid(f) and tipo = 'pintura') <> '{6,1}' then
    raise exception 'Cargas de cabina mal partidas';
  end if;
  raise notice 'OK 7 piezas → cargas de 6 + 1';
end $$;

-- 7. Aseguradora sin autorizar; deducible solo en aseguradora ------------
do $$ declare r jsonb; begin
  r := pg_temp.op('crear_orden', jsonb_build_object('cliente', jsonb_build_object('nombre', 'Prueba Aseguradora'), 'placa', 'ASG-100',
    'tipo', 'Aseguradora', 'aseguradora', 'Seguros Altavista', 'deducible', 2000, 'fecha_prometida', pg_temp.t(5, '12:00'),
    'piezas', '[{"nombre":"Faro","dano":"Reemplazo"}]'::jsonb));
  perform set_config('test.asg', r->>'folio', false);
  if (select estado from public.orden where folio = r->>'folio') <> 'Recibida' then raise exception 'Orden nueva no quedó Recibida'; end if;
end $$;
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.asg'),'desarmado','E','AR',4,'11:00') $$, 'todavía no está Autorizado por la aseguradora');
select pg_temp.debe_fallar($$ select pg_temp.op('autorizar_presupuesto', jsonb_build_object('orden_id', pg_temp.oid(current_setting('test.asg')))) $$, 'Primero emití el presupuesto');
select pg_temp.debe_fallar($$ select pg_temp.op('crear_orden', jsonb_build_object('cliente', jsonb_build_object('nombre','X'), 'placa','XXX-1', 'tipo','Particular', 'deducible', 100, 'fecha_prometida', now(), 'piezas', '[{"nombre":"a","dano":"Leve"}]')) $$, 'deducible solo aplica');

-- 8. Idempotencia y movimiento atómico ----------------------------------
do $$ declare op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; n bigint; f text; begin
  f := pg_temp.nueva('IDM-001', '[{"nombre":"Espejo","dano":"Leve"}]');
  perform set_config('test.idm', f, false);
  r1 := pg_temp.prog(f,'desarmado','A','AR',2,'12:00', 0, op);
  select count(*) into n from public.bloque;
  r2 := pg_temp.prog(f,'desarmado','A','AR',2,'12:00', 0, op);
  if r1->>'folio' <> r2->>'folio' or (select count(*) from public.bloque) <> n or (r2->>'repetida')::boolean is not true then
    raise exception 'Asignación no idempotente';
  end if;
  raise notice 'OK asignación idempotente (%)', r1->>'folio';
end $$;
-- Mover a un hueco ocupado: se rechaza y el bloque original sigue intacto
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'programar_bloque', jsonb_build_object('etapa_id', pg_temp.eid(current_setting('test.idm'),'desarmado'),
  'tecnico_id', pg_temp.tid('A'), 'area_id', pg_temp.aid('AR'), 'inicio', pg_temp.t(3,'09:00'), 'reprogramar', true)) $$, 'llena hasta');
do $$ declare r jsonb; begin
  if not exists (select 1 from public.bloque where etapa_id = pg_temp.eid(current_setting('test.idm'),'desarmado') and _hora(inicio) = '12:00') then
    raise exception 'El rechazo del movimiento borró el bloque original';
  end if;
  r := public.operar(gen_random_uuid(), 'programar_bloque', jsonb_build_object('etapa_id', pg_temp.eid(current_setting('test.idm'),'desarmado'),
    'tecnico_id', pg_temp.tid('A'), 'area_id', pg_temp.aid('AR'), 'inicio', pg_temp.t(2,'13:00'), 'reprogramar', true));
  if (select count(*) from public.bloque where etapa_id = pg_temp.eid(current_setting('test.idm'),'desarmado')) <> 1 then raise exception 'Mover duplicó'; end if;
  raise notice 'OK mover etapa: %', r->>'folio';
end $$;

-- 9. Cancelar orden libera sus bloques futuros ----------------------------
do $$ declare r jsonb; begin
  r := pg_temp.op('cancelar_orden', jsonb_build_object('orden_id', pg_temp.oid(current_setting('test.sab'))));
  if jsonb_array_length(r->'liberados') <> 3 or exists (select 1 from public.bloque b join public.etapa e on e.id = b.etapa_id
       where e.orden_id = pg_temp.oid(current_setting('test.sab'))) then raise exception 'No liberó bloques: %', r; end if;
  raise notice 'OK cancelar libera %', r->'liberados';
end $$;

-- 10. Ciclo completo: Esperando refacción, curado real, QC, entrega -------
do $$ declare f text; begin
  f := pg_temp.nueva('CIC-001', '[{"nombre":"Moldura","dano":"Leve"}]', false);
  perform set_config('test.cic', f, false);
  perform pg_temp.op('alta_refaccion', jsonb_build_object('orden_id', pg_temp.oid(f), 'nombre', 'Moldura nueva', 'costo', 500));
  perform pg_temp.op('registrar_pago', jsonb_build_object('orden_id', pg_temp.oid(f), 'monto', (select anticipo from public.presupuesto where orden_id = pg_temp.oid(f)), 'concepto', 'Anticipo'));
  perform pg_temp.prog(f,'desarmado','A','AR',7,'09:00');
  perform pg_temp.prog(f,'enderezado','A','E1',7,'09:30');
  perform pg_temp.prog(f,'preparacion','C','PR',7,'10:30');
  perform pg_temp.prog(f,'pintura','D','CB',7,'12:00');
end $$;
set role authenticated;
do $$ declare f text := current_setting('test.cic'); t record; begin
  for t in select * from (values ('tecnico.a@taller.test','desarmado'), ('tecnico.a@taller.test','enderezado'),
                                 ('tecnico.c@taller.test','preparacion'), ('tecnico.d@taller.test','pintura')) v(email, tipo) loop
    perform pg_temp.accion(t.email, f, t.tipo, 'iniciar');
    perform pg_temp.accion(t.email, f, t.tipo, 'terminar');
  end loop;
end $$;
reset role;
do $$ declare r jsonb; begin
  if (select estado from public.orden where folio = current_setting('test.cic')) <> 'Esperando refacción' then raise exception 'No pasó a Esperando refacción'; end if;
  r := pg_temp.op('recibir_refaccion', jsonb_build_object('refaccion_id', (select id from public.refaccion where orden_id = pg_temp.oid(current_setting('test.cic')))));
  if r->>'orden_estado' <> 'En proceso' then raise exception 'No volvió a En proceso: %', r; end if;
  perform pg_temp.prog(current_setting('test.cic'),'pulido_armado','E','AR',8,'09:00');
  raise notice 'OK Esperando refacción → En proceso';
end $$;
set role authenticated;
select pg_temp.debe_fallar($$ select pg_temp.accion('tecnico.e@taller.test', current_setting('test.cic'), 'pulido_armado', 'iniciar') $$, 'la pintura cura hasta');
reset role;
select pg_temp.debe_fallar($$ select pg_temp.op('control_calidad', jsonb_build_object('orden_id', pg_temp.oid(current_setting('test.cic')))) $$, 'falta terminar Pulido y armado');
select pg_temp.op('guardar_config', '{"config":{"curado_horas":0,"horneado_horas":0}}');  -- simula que ya curó
set role authenticated;
do $$ begin
  perform pg_temp.accion('tecnico.e@taller.test', current_setting('test.cic'), 'pulido_armado', 'iniciar');
  perform pg_temp.accion('tecnico.e@taller.test', current_setting('test.cic'), 'pulido_armado', 'terminar');
end $$;
reset role;
select pg_temp.op('guardar_config', '{"config":{"curado_horas":12,"horneado_horas":1}}');
do $$ declare r jsonb; begin
  r := pg_temp.op('control_calidad', jsonb_build_object('orden_id', pg_temp.oid(current_setting('test.cic'))));
  if r->>'estado' <> 'Lista para entrega' then raise exception 'QC no dejó Lista para entrega: %', r; end if;
  raise notice 'OK control de calidad → Lista para entrega';
end $$;
select pg_temp.debe_fallar($$ select pg_temp.op('entregar_orden', jsonb_build_object('orden_id', pg_temp.oid(current_setting('test.cic')))) $$, 'falta cobrarle al cliente');

-- 11. RLS ----------------------------------------------------------------
set role authenticated;
select pg_temp.como('tecnico.a@taller.test');
do $$ declare n int; begin
  if exists (select 1 from public.bloque where tecnico_id <> public.mi_tecnico_id()) then raise exception 'Técnico ve bloques ajenos'; end if;
  if (select count(*) from public.bloque) = 0 then raise exception 'Técnico no ve sus bloques'; end if;
  select count(*) into n from public.orden where folio = 'OT-0005';   -- A no tiene bloques en OT-0005
  if n <> 0 then raise exception 'Técnico ve una orden ajena'; end if;
  if exists (select 1 from public.etapa e where not public.es_orden_del_tecnico(e.orden_id)) then raise exception 'Técnico ve etapas ajenas'; end if;
  if exists (select 1 from public.ausencia where tecnico_id <> public.mi_tecnico_id()) then raise exception 'Técnico ve ausencias ajenas'; end if;
  if (select count(*) from public.presupuesto) + (select count(*) from public.pago) + (select count(*) from public.refaccion)
     + (select count(*) from public.cliente) + (select count(*) from public.config) <> 0 then raise exception 'Técnico ve importes'; end if;
  if public.orden_finanzas((select id from public.orden limit 1)) is not null then raise exception 'Técnico ve finanzas'; end if;
  raise notice 'OK RLS técnico';
end $$;
select pg_temp.debe_fallar($$ select deducible from public.orden $$, 'permission denied');
select pg_temp.debe_fallar($$ select tarifa_hora from public.tecnico $$, 'permission denied');
select pg_temp.debe_fallar($$ insert into public.bloque (area_id, inicio, fin, tipo) values (pg_temp.aid('CB'), now(), now() + interval '1h', 'mantenimiento') $$, 'permission denied');
select pg_temp.debe_fallar($$ update public.etapa set estado = 'Terminada' $$, 'permission denied');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0005','desarmado'), 'accion', 'iniciar')) $$, 'Etapa inexistente');
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'etapa_accion', jsonb_build_object('etapa_id', pg_temp.eid('OT-0003','preparacion'), 'accion', 'iniciar')) $$, 'no es tuya');

select pg_temp.como('asesor@taller.test');
do $$ begin
  if (select count(*) from public.config_finanzas) <> 0 then raise exception 'Asesor ve finanzas de configuración'; end if;
  if public.tecnicos_admin() <> '[]'::jsonb then raise exception 'Asesor ve tarifas de técnicos'; end if;
  if exists (select 1 from jsonb_array_elements(public.refacciones_listado()) x where x ? 'costo' or x ? 'margen') then raise exception 'Asesor ve costos'; end if;
  if public.orden_finanzas(pg_temp.oid('OT-0002')) ? 'margen' or (public.orden_finanzas(pg_temp.oid('OT-0002'))->'refacciones'->0) ? 'costo' then raise exception 'Asesor ve margen o costo'; end if;
  if (select count(*) from public.liquidacion_detalle) <> 0 or public.panel_gerencia(current_date) is not null then raise exception 'Asesor ve márgenes'; end if;
  if (select count(*) from public.orden) = 0 then raise exception 'Asesor no ve órdenes'; end if;
  raise notice 'OK RLS asesor';
end $$;
select pg_temp.debe_fallar($$ select costo from public.refaccion $$, 'permission denied');
select pg_temp.debe_fallar($$ select pg_temp.op('guardar_config', '{"config":{"tarifa_mo":1}}') $$, 'Solo gerencia');

select pg_temp.como('gerencia@taller.test');
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.refacciones_listado()) x where x ? 'costo') then raise exception 'Gerencia no ve costos'; end if;
  if not public.orden_finanzas(pg_temp.oid('OT-0006')) ? 'margen' then raise exception 'Gerencia no ve margen'; end if;
  raise notice 'OK gerencia ve costos y margen';
end $$;
reset role;

set role anon;
select pg_temp.debe_fallar($$ select folio from public.orden $$, 'permission denied');
do $$ declare r jsonb; begin
  r := public.consulta_publica('ot-0001', 'pzk 482-b');
  if r is null or (r->>'saldo')::numeric <> 4970.60 or r ? 'folio' or r ? 'placa' or not (r ? 'etapa_actual' and r ? 'fecha_prometida') then
    raise exception 'Consulta pública incorrecta: %', r;
  end if;
  if public.consulta_publica('OT-0001', 'MXR-219-C') is not null or public.consulta_publica('OT-0002', 'PZK-482-B') is not null then
    raise exception 'Consulta pública filtra folio ajeno';
  end if;
  raise notice 'OK consulta pública: %', r;
end $$;
select pg_temp.debe_fallar($$ select public.operar(gen_random_uuid(), 'registrar_pago', '{}') $$, 'permission denied');
reset role;

-- 12. Atraso -------------------------------------------------------------
do $$ begin
  if not (select atrasada from public.v_orden_lista where folio = 'OT-0003') then raise exception 'OT-0003 debería estar atrasada'; end if;
  if not exists (select 1 from public.v_planificador where orden_folio = 'OT-0003' and atrasada) then raise exception 'Atraso no marcado en planificador'; end if;
  if not exists (select 1 from jsonb_array_elements(public.panel_gerencia(public._semana_de(now()))->'atrasos') x where x->>'folio' = 'OT-0003') then
    raise exception 'Atraso no marcado en panel';
  end if;
  raise notice 'OK atraso marcado';
end $$;

-- 13. Ganancia y liquidación de la semana pasada --------------------------
do $$ declare p jsonb; l jsonb; fila jsonb; op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; sem date := public._semana_de(now()) - 7; begin
  p := public.panel_gerencia(sem);
  -- OT-0006: subtotal 2.450 − horas reales (0,5×160 + 1×150 + 1×140 + 1×180 + 1×130 = 680) − materiales 650 = 1.120
  if (p->>'ganancia')::numeric <> 1120 or (p->>'horas_vendidas')::numeric <> 4 then raise exception 'Panel semana pasada: %', p; end if;
  perform pg_temp.op('guardar_config', '{"finanzas":{"umbral_bono_horas":0.5}}');
  l := public.liquidacion_semana(sem);
  select x into fila from jsonb_array_elements(l->'filas') x where x->>'tecnico_nombre' = 'Técnico B';
  -- B: 1 h productiva × $150 = 150; bono (1 − 0,5) × $60 = 30
  if (fila->>'horas_productivas')::numeric <> 1 or (fila->>'bono')::numeric <> 30 or (fila->>'total')::numeric <> 180 then
    raise exception 'Liquidación mal calculada: %', fila;
  end if;
  r1 := public.operar(op, 'cerrar_liquidacion', jsonb_build_object('semana_inicio', sem));
  r2 := public.operar(op, 'cerrar_liquidacion', jsonb_build_object('semana_inicio', sem));
  if (r2->>'repetida')::boolean is not true or r1->>'liquidacion_id' <> r2->>'liquidacion_id' then raise exception 'Cierre no idempotente'; end if;
  perform pg_temp.op('guardar_config', '{"finanzas":{"umbral_bono_horas":30}}');
  if (public.liquidacion_semana(sem)->>'estado') <> 'Cerrada' then raise exception 'No quedó cerrada'; end if;
  raise notice 'OK ganancia % y liquidación cerrada %', p->>'ganancia', r1;
end $$;
select pg_temp.debe_fallar($$ select pg_temp.op('cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now()) - 7)) $$, 'ya está cerrada');
select pg_temp.debe_fallar($$ select pg_temp.op('cancelar_bloque', jsonb_build_object('bloque_id', (select id from public.bloque where folio = 'B-0017'))) $$, 'Terminada');
select pg_temp.debe_fallar($$ update public.liquidacion_detalle set bono = 0 $$, 'solo lectura');
select pg_temp.debe_fallar($$ select pg_temp.prog(current_setting('test.idm'),'enderezado','A','E2',-3,'09:00') $$, 'liquidada');
set role authenticated;
do $$ begin perform pg_temp.accion('tecnico.a@taller.test', 'OT-0002', 'desarmado', 'iniciar'); end $$;
reset role;
select pg_temp.debe_fallar($$ select pg_temp.op('cerrar_liquidacion', jsonb_build_object('semana_inicio', public._semana_de(now()))) $$, 'En curso');

\echo '=== Todas las pruebas SQL pasaron ==='
