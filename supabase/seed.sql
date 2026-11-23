-- =====================================================================
-- Tablero de bahías · Semilla (datos sintéticos, MXN)
-- Ejecutar DESPUÉS de las migraciones (supabase db reset lo hace solo,
-- o pegarlo en el SQL Editor del proyecto).
--
-- Cuentas de prueba (contraseña para todas: Taller2026!)
--   gerencia@taller.test   · gerencia
--   asesor@taller.test     · asesor
--   tecnico.a@taller.test … tecnico.e@taller.test · técnico A–E
-- =====================================================================

-- ---------- Configuración (editable por gerencia) ----------
insert into public.config (id) values (1) on conflict (id) do nothing;          -- $450/h, $650 por pieza pintada, IVA 16%, anticipo 50%
insert into public.config_finanzas (id) values (1) on conflict (id) do nothing; -- refacciones +15%, bono $60/h sobre 30 h productivas

-- ---------- Horario del taller ----------
insert into public.horario_taller (dia, inicio, fin)
select d, h.i::time, h.f::time
  from generate_series(1, 5) d, (values ('09:00', '14:00'), ('16:00', '18:00')) h(i, f)
 where not exists (select 1 from public.horario_taller);
insert into public.horario_taller (dia, inicio, fin)
select 6, '09:30', '13:00' where not exists (select 1 from public.horario_taller where dia = 6);

-- ---------- Áreas (un color por área) ----------
insert into public.area (id, nombre, tipo, capacidad, color, orden) values
  ('20000000-0000-4000-8000-000000000001', 'Bahía de enderezado 1',    'enderezado',  1, '#3E7CB1', 1),
  ('20000000-0000-4000-8000-000000000002', 'Bahía de enderezado 2',    'enderezado',  1, '#6FA8D6', 2),
  ('20000000-0000-4000-8000-000000000003', 'Bahía de preparación',     'preparacion', 2, '#8E5BB5', 3),
  ('20000000-0000-4000-8000-000000000004', 'Cabina de pintura',        'cabina',      1, '#2F9E6E', 4),
  ('20000000-0000-4000-8000-000000000005', 'Bahía de armado y pulido', 'armado',      2, '#2A8C99', 5)
on conflict (id) do nothing;

-- ---------- Catálogo de etapas (orden fijo; horas por pieza según daño) ----------
insert into public.catalogo_etapa (tipo, nombre, secuencia, especialidades, area_tipo, programable, vendible, h_leve, h_medio, h_fuerte, h_reemplazo, horas_fijas) values
  ('desarmado',       'Desarmado',          1, '{armado}',        'armado',      true,  true,  0.5,  0.5,  0.5,  0.5,  null),
  ('enderezado',      'Enderezado',         2, '{enderezado}',    'enderezado',  true,  true,  1.0,  2.5,  4.0,  0.0,  null),
  ('preparacion',     'Preparación',        3, '{preparacion}',   'preparacion', true,  true,  1.0,  1.5,  2.0,  1.0,  null),
  ('pintura',         'Pintura',            4, '{pintura}',       'cabina',      true,  true,  0.75, 0.75, 0.75, 0.75, null),
  ('pulido_armado',   'Pulido y armado',    5, '{pulido,armado}', 'armado',      true,  true,  0.75, 0.75, 0.75, 0.75, null),
  ('control_calidad', 'Control de calidad', 6, '{}',              null,          false, false, 0,    0,    0,    0,    0.5)
on conflict (tipo) do nothing;

-- ---------- Técnicos A–E (tarifa = costo por hora) ----------
insert into public.tecnico (id, nombre, especialidades, tarifa_hora, dias_laborables) values
  ('10000000-0000-4000-8000-00000000000a', 'Técnico A', '{enderezado,armado}',   160, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000b', 'Técnico B', '{enderezado}',          150, '{1,2,3,4,5}'),
  ('10000000-0000-4000-8000-00000000000c', 'Técnico C', '{preparacion,pulido}',  140, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000d', 'Técnico D', '{pintura,preparacion}', 180, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000e', 'Técnico E', '{armado,pulido}',       130, '{1,2,3,4,5,6}')
on conflict (id) do nothing;

-- ---------- Cuentas de prueba (Supabase Auth, ya confirmadas) ----------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-8000-000000000001'::uuid, 'gerencia@taller.test',  'Marta (Gerencia)', 'gerencia', null::uuid),
      ('00000000-0000-4000-8000-000000000002'::uuid, 'asesor@taller.test',    'Nico (Asesor)',    'asesor',   null::uuid),
      ('00000000-0000-4000-8000-00000000001a'::uuid, 'tecnico.a@taller.test', 'Técnico A',        'tecnico',  '10000000-0000-4000-8000-00000000000a'::uuid),
      ('00000000-0000-4000-8000-00000000001b'::uuid, 'tecnico.b@taller.test', 'Técnico B',        'tecnico',  '10000000-0000-4000-8000-00000000000b'::uuid),
      ('00000000-0000-4000-8000-00000000001c'::uuid, 'tecnico.c@taller.test', 'Técnico C',        'tecnico',  '10000000-0000-4000-8000-00000000000c'::uuid),
      ('00000000-0000-4000-8000-00000000001d'::uuid, 'tecnico.d@taller.test', 'Técnico D',        'tecnico',  '10000000-0000-4000-8000-00000000000d'::uuid),
      ('00000000-0000-4000-8000-00000000001e'::uuid, 'tecnico.e@taller.test', 'Técnico E',        'tecnico',  '10000000-0000-4000-8000-00000000000e'::uuid)
    ) as t(id, email, nombre, rol, tecnico_id)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Taller2026!', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', u.nombre), now(), now(),
            '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now())
    on conflict do nothing;

    insert into public.perfil (user_id, rol, nombre, tecnico_id) values (u.id, u.rol, u.nombre, u.tecnico_id)
    on conflict (user_id) do nothing;
  end loop;
end $$;

-- ---------- Órdenes de ejemplo (fechas relativas a la semana actual; 0 = lunes) ----------
create or replace function pg_temp.t(p_dia int, p_hora text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Mexico_City')::date + p_dia) + p_hora::time)::timestamp
         at time zone 'America/Mexico_City'
$$;

create or replace function pg_temp.prog(p_orden uuid, p_tipo text, p_tec text, p_area text, p_dia int, p_hora text) returns jsonb
language sql as $$
  select public.operar(gen_random_uuid(), 'programar_bloque', jsonb_build_object(
    'etapa_id', (select id from public.etapa where orden_id = p_orden and tipo = p_tipo and carga = 1),
    'tecnico_id', (select id from public.tecnico where nombre = 'Técnico ' || p_tec),
    'area_id', (select id from public.area where nombre = p_area),
    'inicio', pg_temp.t(p_dia, p_hora)))
$$;

create or replace function pg_temp.orden(p_cliente text, p_tel text, p_placa text, p_tipo text, p_prometida timestamptz,
                                         p_piezas jsonb, p_aseg text default null, p_ded numeric default 0) returns uuid
language sql as $$
  select (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', p_cliente, 'telefono', p_tel), 'placa', p_placa, 'tipo', p_tipo,
    'aseguradora', p_aseg, 'deducible', p_ded, 'fecha_prometida', p_prometida, 'piezas', p_piezas)) ->> 'orden_id')::uuid
$$;

create or replace function pg_temp.anticipo(p_orden uuid) returns void language sql as $$
  select public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', p_orden));
  select public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', p_orden,
    'monto', (select anticipo from public.presupuesto where orden_id = p_orden), 'concepto', 'Anticipo', 'metodo', 'Transferencia'));
$$;

do $$
declare
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid;
  E1 text := 'Bahía de enderezado 1'; E2 text := 'Bahía de enderezado 2'; PR text := 'Bahía de preparación';
  CB text := 'Cabina de pintura'; AR text := 'Bahía de armado y pulido';
begin
  if exists (select 1 from public.orden) then
    raise notice 'Ya hay órdenes: se omiten las de ejemplo';
    return;
  end if;
  -- Actuamos como la cuenta de gerencia para pasar por public.operar()
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

  -- OT-0001 · Caso resuelto del encargo (particular, falta el anticipo)
  --   9 h × $450 = 4.050 · materiales 2 × 650 = 1.300 · refacción 2.800 + 15% = 3.220
  --   subtotal 8.570 · IVA 1.371,20 · total 9.941,20 · anticipo 4.970,60
  o1 := pg_temp.orden('Laura Méndez', '5214770000001', 'PZK-482-B', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Puerta delantera izquierda","dano":"Medio"},{"nombre":"Salpicadera delantera izquierda","dano":"Reemplazo"}]');
  perform public.operar(gen_random_uuid(), 'alta_refaccion', jsonb_build_object('orden_id', o1, 'nombre', 'Salpicadera delantera izquierda', 'costo', 2800));
  perform public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', o1));

  -- OT-0002 · Aseguradora autorizada; el enderezado de 4 h se parte en el corte de mediodía
  o2 := pg_temp.orden('Jorge Ríos', '5214770000002', 'MXR-219-C', 'Aseguradora', pg_temp.t(5, '13:00'),
    '[{"nombre":"Cofre","dano":"Fuerte"},{"nombre":"Faro delantero derecho","dano":"Reemplazo"}]', 'Seguros Altavista', 3500);
  perform public.operar(gen_random_uuid(), 'alta_refaccion', jsonb_build_object('orden_id', o2, 'nombre', 'Faro delantero derecho', 'costo', 1500));
  perform public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', o2));
  perform public.operar(gen_random_uuid(), 'autorizar_presupuesto', jsonb_build_object('orden_id', o2));
  perform pg_temp.prog(o2, 'desarmado',  'A', AR, 0, '09:00');
  perform pg_temp.prog(o2, 'enderezado', 'B', E1, 0, '12:00');   -- 12:00–14:00 y 16:00–18:00

  -- OT-0003 · Particular con anticipo; curado nocturno; ATRASADA (prometida el martes)
  o3 := pg_temp.orden('Sofía Aguilar', '5214770000003', 'TGH-731-A', 'Particular', pg_temp.t(1, '18:00'),
    '[{"nombre":"Defensa trasera","dano":"Medio"}]');
  perform pg_temp.anticipo(o3);
  perform pg_temp.prog(o3, 'desarmado',     'E', AR, 1, '09:00');
  perform pg_temp.prog(o3, 'enderezado',    'A', E2, 1, '09:30');
  perform pg_temp.prog(o3, 'preparacion',   'C', PR, 1, '12:00');
  perform pg_temp.prog(o3, 'pintura',       'D', CB, 1, '16:00');   -- horneado hasta 18:00
  perform pg_temp.prog(o3, 'pulido_armado', 'E', AR, 2, '09:00');   -- curado hasta el miércoles 06:00

  -- OT-0004 y OT-0005 · listas para pintura el jueves (prueba guiada de la cabina)
  o4 := pg_temp.orden('Ramón Olvera', '5214770000004', 'JKL-905-D', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Facia trasera","dano":"Leve"}]');
  perform pg_temp.anticipo(o4);
  perform pg_temp.prog(o4, 'desarmado',   'A', AR, 3, '09:00');
  perform pg_temp.prog(o4, 'enderezado',  'A', E1, 3, '09:30');
  perform pg_temp.prog(o4, 'preparacion', 'C', PR, 3, '10:30');

  o5 := pg_temp.orden('Daniela Pineda', '5214770000005', 'WQE-318-F', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Salpicadera trasera derecha","dano":"Leve"}]');
  perform pg_temp.anticipo(o5);
  perform pg_temp.prog(o5, 'desarmado',   'E', AR, 3, '09:00');
  perform pg_temp.prog(o5, 'enderezado',  'B', E2, 3, '09:30');
  perform pg_temp.prog(o5, 'preparacion', 'D', PR, 3, '10:30');

  -- Mantenimiento y ausencia
  perform public.operar(gen_random_uuid(), 'programar_mantenimiento', jsonb_build_object(
    'area_id', (select id from public.area where nombre = AR),
    'inicio', pg_temp.t(5, '09:30'), 'fin', pg_temp.t(5, '11:00'), 'nota', 'Revisión del elevador'));
  perform public.operar(gen_random_uuid(), 'guardar_ausencia', jsonb_build_object(
    'tecnico_id', (select id from public.tecnico where nombre = 'Técnico C'),
    'inicio', pg_temp.t(4, '09:00'), 'fin', pg_temp.t(4, '14:00'), 'motivo', 'Trámite personal'));

  -- OT-0006 · Semana pasada, terminada y lista para entrega (alimenta panel y liquidación)
  o6 := pg_temp.orden('Marisol Treviño', '5214770000006', 'LMN-664-E', 'Particular', pg_temp.t(-6, '18:00'),
    '[{"nombre":"Puerta trasera derecha","dano":"Leve"}]');
  perform pg_temp.anticipo(o6);
  perform pg_temp.prog(o6, 'desarmado',     'A', AR, -7, '09:00');
  perform pg_temp.prog(o6, 'enderezado',    'B', E1, -7, '09:30');
  perform pg_temp.prog(o6, 'preparacion',   'C', PR, -7, '10:30');
  perform pg_temp.prog(o6, 'pintura',       'D', CB, -7, '12:00');
  perform pg_temp.prog(o6, 'pulido_armado', 'E', AR, -6, '09:00');
  -- Ejecución histórica: tiempos reales iguales a lo programado
  insert into public.registro_tiempo (etapa_id, tecnico_id, inicio, fin)
  select e.id, b.tecnico_id, b.inicio, b.fin_tecnico
    from public.etapa e join public.bloque b on b.etapa_id = e.id where e.orden_id = o6;
  update public.etapa e set estado = 'Terminada',
         iniciada_en = (select min(inicio) from public.bloque where etapa_id = e.id),
         terminada_en = (select max(fin_tecnico) from public.bloque where etapa_id = e.id)
   where e.orden_id = o6 and e.programable;
  update public.etapa set estado = 'Terminada', iniciada_en = pg_temp.t(-6, '10:30'), terminada_en = pg_temp.t(-6, '11:00')
   where orden_id = o6 and tipo = 'control_calidad';
  perform public._recalcular_estado(o6);
  update public.orden set lista_en = pg_temp.t(-6, '11:00') where id = o6;
  update public.pago set creado_en = pg_temp.t(-7, '08:45') where orden_id = o6;
end $$;
