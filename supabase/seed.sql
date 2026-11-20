-- =====================================================================
-- Tablero de bahías · Semilla mínima (MXN)
-- Ejecutar DESPUÉS de las migraciones (supabase db reset lo hace solo,
-- o pegarlo en el SQL Editor del proyecto).
--
-- Cuentas de prueba (contraseña para todas: Taller2026!)
--   gerencia@taller.test   · gerencia
--   asesor@taller.test     · asesor
--   tecnico.a@taller.test … tecnico.e@taller.test · técnico A–E
-- =====================================================================

-- ---------- Configuración ----------
insert into public.config (id) values (1) on conflict (id) do nothing;
insert into public.config_finanzas (id) values (1) on conflict (id) do nothing;

-- ---------- Áreas (un color por área) ----------
insert into public.area (id, nombre, tipo, capacidad, color, orden) values
  ('20000000-0000-4000-8000-000000000001', 'Bahía 1',           'bahia',       1, '#38bdf8', 1),
  ('20000000-0000-4000-8000-000000000002', 'Bahía 2',           'bahia',       1, '#818cf8', 2),
  ('20000000-0000-4000-8000-000000000003', 'Preparación',       'preparacion', 2, '#c084fc', 3),
  ('20000000-0000-4000-8000-000000000004', 'Cabina de pintura', 'cabina',      1, '#34d399', 4),
  ('20000000-0000-4000-8000-000000000005', 'Pulido',            'pulido',      1, '#f472b6', 5)
on conflict (id) do nothing;

-- ---------- Catálogo de etapas: horas por pieza según daño ----------
insert into public.catalogo_etapa (tipo, nombre, secuencia, especialidad, area_tipo, h_leve, h_medio, h_fuerte, h_reemplazo, material_hora) values
  ('desarmado',   'Desarmado',   1, 'armado',      'bahia',       0.5, 0.5, 1.0, 1.0,   0),
  ('hojalateria', 'Hojalatería', 2, 'hojalateria', 'bahia',       1.0, 2.0, 3.5, 0.5,  40),
  ('preparacion', 'Preparación', 3, 'preparacion', 'preparacion', 1.0, 1.5, 2.0, 1.5, 120),
  ('pintura',     'Pintura',     4, 'pintura',     'cabina',      1.0, 1.0, 1.0, 1.0, 300),
  ('pulido',      'Pulido',      5, 'pulido',      'pulido',      0.5, 0.5, 0.5, 0.5,  40),
  ('armado',      'Armado',      6, 'armado',      'bahia',       0.5, 0.5, 1.0, 1.5,   0)
on conflict (tipo) do nothing;

-- ---------- Técnicos A–E (tarifa = costo por hora vendida) ----------
insert into public.tecnico (id, nombre, especialidades, tarifa_hora, horario) values
  ('10000000-0000-4000-8000-00000000000a', 'Técnico A', '{armado,hojalateria}',   120, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}'),
  ('10000000-0000-4000-8000-00000000000b', 'Técnico B', '{hojalateria,pintura}',  115, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}'),
  ('10000000-0000-4000-8000-00000000000c', 'Técnico C', '{preparacion,pulido}',   100, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}'),
  ('10000000-0000-4000-8000-00000000000d', 'Técnico D', '{pintura,preparacion}',  140, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}'),
  ('10000000-0000-4000-8000-00000000000e', 'Técnico E', '{armado,pulido}',         95, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}')
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

-- ---------- Órdenes de ejemplo (fechas relativas a la semana actual) ----------
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

do $$
declare
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid;
begin
  if exists (select 1 from public.orden) then
    raise notice 'Ya hay órdenes: se omiten las de ejemplo';
    return;
  end if;
  -- Actuamos como la cuenta de gerencia para pasar por public.operar()
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

  -- OT-0001 · Caso briefing (particular, sin anticipo todavía)
  --   MO 12 h × $450 = 5.400 · materiales 1.100 · refacción 1.800 + 15% = 2.070
  --   subtotal 8.570 · IVA 1.371,20 · total 9.941,20 · anticipo 4.970,60
  o1 := (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Laura Méndez', 'telefono', '5215512345678'),
    'placa', 'PZK-482-B', 'tipo', 'Particular', 'fecha_prometida', pg_temp.t(4, '18:00'),
    'piezas', jsonb_build_array(
      jsonb_build_object('nombre', 'Defensa delantera', 'dano', 'Reemplazo'),
      jsonb_build_object('nombre', 'Salpicadera derecha', 'dano', 'Medio')))) ->> 'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'alta_refaccion',
    jsonb_build_object('orden_id', o1, 'nombre', 'Defensa delantera (original)', 'costo', 1800));

  -- OT-0002 · Aseguradora autorizada, en hojalatería
  o2 := (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Jorge Ríos', 'telefono', '5215598765432'),
    'placa', 'MXR-219-C', 'tipo', 'Aseguradora', 'aseguradora', 'Seguros Altavista', 'deducible', 3500,
    'fecha_prometida', pg_temp.t(5, '13:00'),
    'piezas', jsonb_build_array(
      jsonb_build_object('nombre', 'Puerta delantera izquierda', 'dano', 'Fuerte'),
      jsonb_build_object('nombre', 'Espejo lateral izquierdo', 'dano', 'Reemplazo')))) ->> 'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'alta_refaccion',
    jsonb_build_object('orden_id', o2, 'nombre', 'Espejo lateral izquierdo', 'costo', 900));
  perform public.operar(gen_random_uuid(), 'autorizar_presupuesto', jsonb_build_object('orden_id', o2));
  perform pg_temp.prog(o2, 'desarmado',   'A', 'Bahía 1', 0, '09:00');
  perform pg_temp.prog(o2, 'hojalateria', 'B', 'Bahía 1', 0, '11:00');

  -- OT-0003 · Particular con anticipo, cadena completa con curado nocturno → ATRASADA
  o3 := (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Sofía Aguilar', 'telefono', '5215533344455'),
    'placa', 'TGH-731-A', 'tipo', 'Particular', 'fecha_prometida', pg_temp.t(1, '18:00'),
    'piezas', jsonb_build_array(jsonb_build_object('nombre', 'Cofre', 'dano', 'Medio')))) ->> 'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', o3,
    'monto', (select anticipo from public.presupuesto where orden_id = o3), 'concepto', 'Anticipo', 'metodo', 'Transferencia'));
  perform pg_temp.prog(o3, 'desarmado',   'E', 'Bahía 2',           1, '08:00');
  perform pg_temp.prog(o3, 'hojalateria', 'A', 'Bahía 2',           1, '08:30');
  perform pg_temp.prog(o3, 'preparacion', 'C', 'Preparación',       1, '10:30');
  perform pg_temp.prog(o3, 'pintura',     'D', 'Cabina de pintura', 1, '12:00');
  perform pg_temp.prog(o3, 'pulido',      'C', 'Pulido',            2, '08:00');
  perform pg_temp.prog(o3, 'armado',      'E', 'Bahía 2',           2, '08:30');

  -- OT-0004 y OT-0005 · listas para pintura el jueves (prueba guiada de la cabina)
  o4 := (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Ramón Olvera', 'telefono', '5215511122233'),
    'placa', 'JKL-905-D', 'tipo', 'Particular', 'fecha_prometida', pg_temp.t(4, '18:00'),
    'piezas', jsonb_build_array(jsonb_build_object('nombre', 'Facia trasera', 'dano', 'Leve')))) ->> 'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', o4,
    'monto', (select anticipo from public.presupuesto where orden_id = o4), 'concepto', 'Anticipo'));
  perform pg_temp.prog(o4, 'desarmado',   'A', 'Bahía 1',     3, '08:00');
  perform pg_temp.prog(o4, 'hojalateria', 'A', 'Bahía 1',     3, '08:30');
  perform pg_temp.prog(o4, 'preparacion', 'C', 'Preparación', 3, '09:30');

  o5 := (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', 'Daniela Pineda', 'telefono', '5215577788899'),
    'placa', 'WQE-318-F', 'tipo', 'Particular', 'fecha_prometida', pg_temp.t(4, '18:00'),
    'piezas', jsonb_build_array(jsonb_build_object('nombre', 'Salpicadera trasera derecha', 'dano', 'Leve')))) ->> 'orden_id')::uuid;
  perform public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', o5,
    'monto', (select anticipo from public.presupuesto where orden_id = o5), 'concepto', 'Anticipo'));
  perform pg_temp.prog(o5, 'desarmado',   'E', 'Bahía 2',     3, '08:00');
  perform pg_temp.prog(o5, 'hojalateria', 'B', 'Bahía 2',     3, '08:30');
  perform pg_temp.prog(o5, 'preparacion', 'D', 'Preparación', 3, '09:30');

  -- Mantenimiento programado
  perform public.operar(gen_random_uuid(), 'programar_mantenimiento', jsonb_build_object(
    'area_id', (select id from public.area where nombre = 'Bahía 2'),
    'inicio', pg_temp.t(5, '08:00'), 'fin', pg_temp.t(5, '10:00'), 'nota', 'Revisión del elevador'));
end $$;
