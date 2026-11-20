# Tablero de bahías

App web de piso para un taller de colisión: reparte las etapas de reparación entre bahías, la cabina de pintura y los técnicos **sin solapamientos**, calcula presupuestos, cobra anticipos/deducibles y liquida la semana. Interfaz en español rioplatense, montos en MXN.

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Supabase (Auth, RLS, funciones de BD). Es la misma base que usa Lovable, así que el repo se puede importar tal cual.

## Pantallas

| Ruta | Pantalla | Roles |
|---|---|---|
| `/login` | Login con cuentas de prueba (sin confirmación por correo) | todos |
| `/planificador` | Planificador semanal: filas por área, columnas de 30 min, fichas por área/estado, «Programar bloque», conflicto con «Actualizar» | gerencia, asesor |
| `/ordenes` | Lista: folio, placa, cliente, estado, fecha prometida, flag «Atrasada» | gerencia, asesor |
| `/ordenes/:id` | Detalle: etapas en secuencia, estados, refacciones, «Compartir por WhatsApp», «Descargar .ics», «Copiar texto» | gerencia, asesor |
| `/ordenes/nueva` | Nueva orden: cliente, placa, Particular/Aseguradora, piezas con daño (Leve/Medio/Fuerte/Reemplazo), deducible | gerencia, asesor |
| `/ordenes/:id/presupuesto` | Mano de obra, materiales, refacciones (costo +15%), subtotal, IVA 16%, total, anticipo 50%, saldo aseguradora | gerencia, asesor |
| `/pagos` | Registrar anticipo / deducible (op_id idempotente) | gerencia, asesor |
| `/refacciones` | Alta con costo, «Marcar Recibida» (costo y margen solo para gerencia) | gerencia, asesor |
| `/tecnico` | Vista técnico: una columna, botones grandes «En curso», «Pausar», «Terminar», sin importes | técnico (gerencia puede elegir técnico) |
| `/liquidacion` | Horas vendidas/productivas, bono $60/h sobre 30 h, cierre en solo lectura | gerencia |
| `/configuracion` | Tarifas, horas por etapa, áreas, técnicos, mantenimiento, usuarios (rol de solo lectura) | gerencia |
| `/consulta` | Consulta pública por folio + placa: etapa actual, fecha prometida, saldo | público |
| `/panel` | Horas vendidas, ganancia semanal, atrasos, horas por área | gerencia |

## Puesta en marcha

### 1. Proyecto Supabase

1. Creá un proyecto en Supabase.
2. **Authentication → Providers → Email**: desactivá *Confirm email* (las cuentas de prueba ya vienen confirmadas, pero así podés crear otras sin correo).
3. Ejecutá, en este orden, en el **SQL Editor** (o con `supabase db push` si usás la CLI vinculada):
   1. `supabase/migrations/20261120000001_esquema.sql`
   2. `supabase/migrations/20261120000002_funciones.sql`
   3. `supabase/migrations/20261120000003_rls.sql`
   4. `supabase/seed.sql` (semilla, copiada abajo)

Con la CLI en local alcanza con `supabase start` (aplica migraciones + semilla) o `supabase db reset`.

### 2. Front

```bash
cp .env.example .env.local   # completá URL y clave anon (Project Settings → API)
npm install
npm run dev                  # http://localhost:8080
```

En **Lovable**: importá este repositorio desde GitHub, conectá la integración de Supabase al proyecto del paso 1 y definí `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

### Cuentas de prueba

Contraseña para todas: **`Taller2026!`**

| Correo | Rol |
|---|---|
| `gerencia@taller.test` | gerencia |
| `asesor@taller.test` | asesor |
| `tecnico.a@taller.test` … `tecnico.e@taller.test` | técnico A … E |

La pantalla de login tiene botones que completan cada cuenta.

### Secretos

- El navegador usa **solo** la clave pública `anon`. La `service_role` no está en el repo, no se usa en la app y nunca debe ir en una variable `VITE_*` (Vite la embebería en el bundle).
- `.env`, `.env.local` y cualquier `.env.*` están en `.gitignore`; solo se versiona `.env.example`.

## Cómo está hecho (criterios de aceptación)

**Una sola puerta de escritura.** Toda escritura pasa por `public.operar(op_id, tipo, payload)`: asignación de bloques, pagos, cierre de liquidación, alta/recepción de refacciones, avances del técnico y configuración. Corre en una sola transacción, valida rol y estado antes de escribir, y ante cualquier rechazo revierte todo (no quedan escrituras parciales). Es **idempotente por `op_id`**: repetir la llamada devuelve el resultado guardado (`repetida: true`) sin escribir de nuevo. El front reintenta cortes de red con el mismo `op_id`. Los roles `anon` y `authenticated` no tienen INSERT/UPDATE/DELETE sobre ninguna tabla.

**Exclusión de recursos en la BD.** `bloque` guarda `periodo_area` y `periodo_tecnico` como `tstzrange '[)'` (inicio incluido, fin excluido, + margen en minutos) con dos restricciones `EXCLUDE USING gist`: por área + slot y por técnico. Antes de insertar, la función toma locks consultivos por recurso en orden fijo y busca el choque, así el error **nombra el bloque exacto**: `Conflicto: el área ya está ocupada por el bloque B-0016 (OT-0004 · Pintura carga 1 · Técnico D) en Cabina de pintura, 19/11 11:00–13:00.` (SQLSTATE `PT409` → HTTP 409). Áreas con capacidad > 1 (Preparación) usan slots.

**Reglas de programación** (todas en `_programar_bloque`):
- La etapa anterior tiene que estar programada y terminar antes (o justo) del inicio; tampoco se puede romper la secuencia con etapas posteriores ya programadas.
- El técnico debe tener la especialidad de la etapa y trabajar en ese horario; el área debe ser del tipo correcto; bloques alineados a :00/:30 dentro del horario del taller.
- **Cabina:** una carga por bloque, máx. 6 piezas (la orden se parte en cargas al crearse), +1 h de horneado: la cabina queda ocupada y el técnico libre.
- **Curado:** el pulido no empieza antes de 12 h calendario desde el fin de la pintura (incluido horneado), contando el taller cerrado.
- **Armado** bloqueado si hay refacciones sin recibir; al recibir la última, la orden vuelve a «En proceso» y el armado se habilita.
- No se programa sin 50% de anticipo (particular) o presupuesto Autorizado (aseguradora).
- Semana liquidada = solo lectura (ni bloques ni avances).

**Caso briefing** (OT-0001 en la semilla): 12 h × $450 = $5.400 de mano de obra + $1.100 de materiales + refacción $1.800 +15% = $2.070 → subtotal $8.570, IVA $1.371,20, **total $9.941,20, anticipo $4.970,60**.

**Atraso:** una orden está atrasada si el fin de su última etapa programada supera la fecha prometida (o si ya pasó la fecha y no terminó). Se marca en naranja en el planificador, la lista, el detalle, el panel y la consulta pública.

**RLS en todas las tablas.**
- Técnico: solo sus bloques y las órdenes/etapas/piezas donde tiene bloques; sin presupuestos, pagos, refacciones, clientes ni configuración.
- Asesor: sin costos ni márgenes (`tecnico.tarifa_hora`, `refaccion.costo`, `config_finanzas`, liquidación y panel quedan fuera).
- Las columnas sensibles (`tecnico.tarifa_hora`, `refaccion.costo`, `orden.deducible`) no tienen permiso de SELECT por la API: se leen con funciones que chequean el rol (`tecnicos_admin`, `refacciones_listado`, `orden_finanzas`).
- Cambiar un id en la URL o en una consulta nunca devuelve filas ajenas: lo filtra la RLS.
- `consulta_publica(folio, placa)` es lo único que puede ejecutar `anon` y exige que folio **y** placa coincidan; con un folio ajeno devuelve `null`.

**Liquidación:** horas vendidas = horas de catálogo de las etapas que el técnico terminó en la semana; productivas = tiempo real en «En curso». Pago = horas vendidas × tarifa + bono de $60 por hora vendida sobre 30. Al cerrar se congela una foto (`liquidacion_detalle`) protegida con triggers contra UPDATE/DELETE.

**Ganancia semanal (panel):** venta de mano de obra de lo terminado − pago a técnicos (base + bonos) + margen de refacciones recibidas.

## Pruebas

### Prueba guiada: dos sesiones compiten por la misma cabina

La semilla deja OT-0004 y OT-0005 con preparación terminando el jueves a las 10:30 y la pintura pendiente.

1. Abrí dos navegadores (o una ventana normal y una privada). En uno entrá como `gerencia@taller.test` y en el otro como `asesor@taller.test`. Ambos en **Planificador**.
2. En los dos: «Programar bloque» → jueves 11:00, área **Cabina de pintura**.
   - Gerencia: OT-0004 · Pintura · Técnico D.
   - Asesor: OT-0005 · Pintura · Técnico B.
3. Apretá «Programar bloque» en los dos lo más juntos posible.
4. Resultado: una sesión programa; la otra ve el aviso naranja `Conflicto: el área ya está ocupada por el bloque B-00xx (…)`, el bloque ganador parpadea en la grilla y nada quedó ocupado para esa orden. «Actualizar» recarga el tablero.

Por la API, con las dos cuentas en paralelo:

```bash
npm run carrera   # lee .env.local; usa solo la clave anon
```

### Pruebas de la base de datos

`scripts/db-local.sh` levanta una BD en un Postgres ≥ 15 local con un stub mínimo de Supabase, aplica migraciones y semilla, y corre:

- `supabase/tests/01_pruebas.sql`: briefing, anticipo, idempotencia de pago/asignación/cierre, conflictos con nombre de bloque, fin excluido, margen, secuencia, especialidad, cabina (cargas de 6 y horneado con técnico libre), curado nocturno, armado bloqueado y vuelta a «En proceso», aseguradora sin autorizar, RLS por rol y para `anon`, consulta pública, atraso en vista y panel, avance del técnico, liquidación con bono y solo lectura. Cada rechazo además verifica que no haya escrituras parciales.
- `supabase/tests/02_carrera.sh`: dos sesiones `psql` concurrentes; la primera retiene la transacción 2 s, la segunda espera, recibe el conflicto con el folio ganador y no escribe nada.

```bash
npm run test:db
```

## Supuestos

- No recibí el briefing original con los datos de los técnicos A–E. Los cargué así (se editan en Configuración → Técnicos): A armado+hojalatería $120/h; B hojalatería+pintura $115/h; C preparación+pulido $100/h; D pintura+preparación $140/h; E armado+pulido $95/h; todos lun–sáb 08:00–17:00. El catálogo de horas está calibrado para que el caso del briefing dé exactamente $9.941,20.
- Taller: lun–sáb 08:00–19:00, zona `America/Mexico_City`. Las órdenes de ejemplo se fechan relativas a la semana en que se corre la semilla.
- «Desarmado» y «Armado» usan la especialidad `armado`. El curado no ocupa recurso: es una restricción de tiempo entre pintura y pulido.

## Compartir el proyecto

Pendiente de hacer a mano por quien sea dueño de las cuentas: invitar a **partners@kodarvia.com** como colaborador del repositorio de GitHub, del proyecto de Lovable y de la organización de Supabase.

## Semilla SQL

Es el contenido de [`supabase/seed.sql`](supabase/seed.sql), que es el archivo fuente:

<details>
<summary>Ver SQL de semilla</summary>

```sql
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
```

</details>
