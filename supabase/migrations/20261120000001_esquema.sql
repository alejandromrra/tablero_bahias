-- =====================================================================
-- Tablero de bahías · Esquema
-- Taller de colisión: órdenes, etapas, bloques sin solapamientos,
-- presupuestos, pagos, refacciones y liquidación semanal.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto  with schema extensions;

-- ---------------------------------------------------------------------
-- Configuración editable por gerencia (fila única).
-- Lo operativo lo leen gerencia y asesor; markup y bono, solo gerencia.
-- ---------------------------------------------------------------------
create table public.config (
  id                 int primary key default 1 check (id = 1),
  tarifa_mo          numeric(10,2) not null default 450  check (tarifa_mo >= 0),      -- $ por hora vendida
  material_pieza     numeric(10,2) not null default 650  check (material_pieza >= 0), -- $ por pieza que pasa por pintura
  iva                numeric(6,4)  not null default 0.16 check (iva between 0 and 1),
  anticipo_pct       numeric(6,4)  not null default 0.50 check (anticipo_pct between 0 and 1),
  curado_horas       numeric(6,2)  not null default 12   check (curado_horas >= 0),   -- horas calendario, corre con el taller cerrado
  horneado_horas     numeric(6,2)  not null default 1    check (horneado_horas >= 0), -- por carga: cabina ocupada, técnico libre
  cabina_max_piezas  int           not null default 6    check (cabina_max_piezas > 0),
  margen_default_min int           not null default 0    check (margen_default_min between 0 and 240),
  zona_horaria       text          not null default 'America/Mexico_City',
  actualizado_en     timestamptz   not null default now()
);

create table public.config_finanzas (
  id                  int primary key default 1 check (id = 1),
  markup_refacciones  numeric(6,4)  not null default 0.15 check (markup_refacciones >= 0),
  bono_hora           numeric(10,2) not null default 60   check (bono_hora >= 0),
  umbral_bono_horas   numeric(6,2)  not null default 30   check (umbral_bono_horas >= 0)
);

-- Franjas de atención por día ISO (1 = lunes … 7 = domingo). Puede haber varias por día.
create table public.horario_taller (
  id      uuid primary key default gen_random_uuid(),
  dia     int  not null check (dia between 1 and 7),
  inicio  time not null,
  fin     time not null,
  check (fin > inicio),
  check (extract(minute from inicio)::int in (0, 30) and extract(minute from fin)::int in (0, 30)),
  constraint horario_sin_solape exclude using gist (dia with =, tsrange('2000-01-01'::date + inicio, '2000-01-01'::date + fin, '[)') with &&)
);

-- ---------------------------------------------------------------------
-- Recursos: áreas y técnicos
-- ---------------------------------------------------------------------
create table public.area (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  tipo       text not null check (tipo in ('enderezado','preparacion','cabina','armado')),
  capacidad  int  not null default 1 check (capacidad between 1 and 10), -- autos (o cargas) simultáneos
  color      text not null default '#5B6B7A' check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden      int  not null default 0,
  activa     boolean not null default true
);

create table public.tecnico (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null unique,
  especialidades   text[] not null default '{}',
  tarifa_hora      numeric(10,2) not null default 0 check (tarifa_hora >= 0), -- COSTO: solo gerencia
  dias_laborables  int[] not null default '{1,2,3,4,5,6}',                     -- trabaja en las franjas del taller de esos días
  activo           boolean not null default true,
  check (especialidades <@ array['armado','enderezado','preparacion','pintura','pulido']::text[]),
  check (dias_laborables <@ array[1,2,3,4,5,6,7])
);

create table public.ausencia (
  id          uuid primary key default gen_random_uuid(),
  tecnico_id  uuid not null references public.tecnico(id) on delete cascade,
  inicio      timestamptz not null,
  fin         timestamptz not null,
  motivo      text,
  check (fin > inicio)
);
create index on public.ausencia (tecnico_id, inicio);

-- Perfil: un solo rol por usuario; ningún formulario lo edita.
create table public.perfil (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  rol        text not null check (rol in ('gerencia','asesor','tecnico')),
  nombre     text not null,
  tecnico_id uuid unique references public.tecnico(id),
  check ((rol = 'tecnico') = (tecnico_id is not null))
);

-- ---------------------------------------------------------------------
-- Catálogo de etapas (orden fijo)
-- ---------------------------------------------------------------------
create table public.catalogo_etapa (
  tipo            text primary key check (tipo in ('desarmado','enderezado','preparacion','pintura','pulido_armado','control_calidad')),
  nombre          text not null,
  secuencia       int  not null unique,
  especialidades  text[] not null default '{}',  -- el técnico necesita al menos una
  area_tipo       text check (area_tipo in ('enderezado','preparacion','cabina','armado')),
  programable     boolean not null default true,  -- control de calidad no ocupa área ni técnico
  vendible        boolean not null default true,  -- suma a horas vendidas
  h_leve          numeric(5,2) not null default 0 check (h_leve >= 0),      -- horas por pieza según daño
  h_medio         numeric(5,2) not null default 0 check (h_medio >= 0),
  h_fuerte        numeric(5,2) not null default 0 check (h_fuerte >= 0),
  h_reemplazo     numeric(5,2) not null default 0 check (h_reemplazo >= 0),
  horas_fijas     numeric(5,2) check (horas_fijas > 0)                       -- por orden (control de calidad)
);

-- ---------------------------------------------------------------------
-- Órdenes
-- ---------------------------------------------------------------------
create table public.cliente (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  telefono  text,
  email     text,
  creado_en timestamptz not null default now()
);

create sequence public.orden_folio_seq;

create table public.orden (
  id               uuid primary key default gen_random_uuid(),
  folio            text not null unique default ('OT-' || lpad(nextval('public.orden_folio_seq')::text, 4, '0')),
  placa            text not null check (placa ~ '^[A-Z0-9-]{3,12}$'),
  cliente_id       uuid not null references public.cliente(id),
  tipo             text not null check (tipo in ('Particular','Aseguradora')),
  aseguradora      text,
  estado           text not null default 'Recibida'
                   check (estado in ('Recibida','Presupuestada','Autorizada','En proceso','Esperando refacción',
                                     'Lista para entrega','Entregada','Cancelada')),
  fecha_prometida  timestamptz not null,
  deducible        numeric(12,2) not null default 0 check (deducible >= 0),
  lista_en         timestamptz,
  entregada_en     timestamptz,
  cancelada_en     timestamptz,
  creado_por       uuid references auth.users(id),
  creado_en        timestamptz not null default now(),
  check (tipo = 'Aseguradora' or deducible = 0)
);
create index on public.orden (cliente_id);

create table public.pieza (
  id        uuid primary key default gen_random_uuid(),
  orden_id  uuid not null references public.orden(id) on delete cascade,
  nombre    text not null,
  dano      text not null check (dano in ('Leve','Medio','Fuerte','Reemplazo'))
);
create index on public.pieza (orden_id);

create table public.etapa (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.orden(id) on delete cascade,
  tipo            text not null references public.catalogo_etapa(tipo),
  secuencia       int  not null,
  carga           int  not null default 1,          -- pintura: una etapa por carga de cabina
  area_tipo       text,
  area_id         uuid references public.area(id),  -- área donde quedó programada
  especialidades  text[] not null default '{}',
  programable     boolean not null default true,
  vendible        boolean not null default true,
  horas           numeric(5,2) not null check (horas > 0),   -- horas vendidas (pintura sin horneado)
  piezas          int not null default 0,
  estado          text not null default 'Pendiente'
                  check (estado in ('Pendiente','Programada','En curso','Pausada','Terminada')),
  iniciada_en     timestamptz,
  terminada_en    timestamptz,
  unique (orden_id, tipo, carga)
);
create index on public.etapa (orden_id, secuencia);

-- ---------------------------------------------------------------------
-- Bloques del planificador: inicio incluido, fin excluido (+ margen).
-- Una etapa larga se parte en tramos (mismo técnico, misma área).
-- La exclusión por recurso la garantiza la BD con EXCLUDE.
-- ---------------------------------------------------------------------
create sequence public.bloque_folio_seq;

create table public.bloque (
  id               uuid primary key default gen_random_uuid(),
  folio            text not null unique default ('B-' || lpad(nextval('public.bloque_folio_seq')::text, 4, '0')),
  tipo             text not null default 'trabajo' check (tipo in ('trabajo','mantenimiento')),
  etapa_id         uuid references public.etapa(id) on delete cascade,
  tramo            int  not null default 1 check (tramo >= 1),
  tecnico_id       uuid references public.tecnico(id),
  area_id          uuid not null references public.area(id),
  slot             int  not null default 1 check (slot >= 1),
  inicio           timestamptz not null,           -- incluido
  fin              timestamptz not null,           -- excluido (incluye horneado en cabina)
  fin_tecnico      timestamptz,                    -- excluido; = inicio si el tramo es solo horneado
  margen           int not null default 0 check (margen between 0 and 240), -- minutos de holgura tras el fin
  nota             text,
  periodo_area     tstzrange not null,
  periodo_tecnico  tstzrange,
  creado_por       uuid references auth.users(id),
  creado_en        timestamptz not null default now(),
  unique (etapa_id, tramo),
  check (fin > inicio),
  check (fin_tecnico is null or (fin_tecnico >= inicio and fin_tecnico <= fin)),
  check (tipo = 'mantenimiento' or (etapa_id is not null and tecnico_id is not null and fin_tecnico is not null)),
  check (tipo = 'trabajo' or (etapa_id is null and tecnico_id is null)),
  constraint bloque_sin_solape_area
    exclude using gist (area_id with =, slot with =, periodo_area with &&),
  constraint bloque_sin_solape_tecnico
    exclude using gist (tecnico_id with =, periodo_tecnico with &&) where (periodo_tecnico is not null)
);
create index on public.bloque (tecnico_id, inicio);
create index on public.bloque (inicio);
create index on public.bloque (etapa_id);

create or replace function public._bloque_periodos() returns trigger
language plpgsql as $$
begin
  new.periodo_area := tstzrange(new.inicio, new.fin + make_interval(mins => new.margen), '[)');
  new.periodo_tecnico := case
    when new.tecnico_id is null or new.fin_tecnico is null or new.fin_tecnico = new.inicio then null
    else tstzrange(new.inicio, new.fin_tecnico + make_interval(mins => new.margen), '[)') end;
  return new;
end $$;

create trigger bloque_periodos before insert or update on public.bloque
for each row execute function public._bloque_periodos();

-- Tiempo real trabajado (horas productivas)
create table public.registro_tiempo (
  id          uuid primary key default gen_random_uuid(),
  etapa_id    uuid not null references public.etapa(id) on delete cascade,
  tecnico_id  uuid not null references public.tecnico(id),
  inicio      timestamptz not null,
  fin         timestamptz,
  check (fin is null or fin >= inicio)
);
create unique index registro_abierto_por_tecnico on public.registro_tiempo (tecnico_id) where fin is null;

-- ---------------------------------------------------------------------
-- Dinero
-- ---------------------------------------------------------------------
create table public.refaccion (
  id            uuid primary key default gen_random_uuid(),
  orden_id      uuid not null references public.orden(id) on delete cascade,
  nombre        text not null,
  costo         numeric(12,2) not null check (costo > 0),        -- COSTO: solo gerencia
  precio_venta  numeric(12,2) not null check (precio_venta >= 0), -- costo + markup, congelado al dar de alta
  estado        text not null default 'Pedida' check (estado in ('Pedida','Recibida')),
  recibida_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create index on public.refaccion (orden_id);

create table public.presupuesto (
  orden_id        uuid primary key references public.orden(id) on delete cascade,
  horas_vendidas  numeric(8,2)  not null default 0,
  mano_obra       numeric(12,2) not null default 0,
  materiales      numeric(12,2) not null default 0,
  refacciones     numeric(12,2) not null default 0,
  subtotal        numeric(12,2) not null default 0,
  iva             numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  anticipo        numeric(12,2) not null default 0,
  estado          text not null default 'Borrador' check (estado in ('Borrador','Emitido','Autorizado')),
  emitido_en      timestamptz,
  autorizado_por  uuid references auth.users(id),
  autorizado_en   timestamptz,
  actualizado_en  timestamptz not null default now()
);

create table public.pago (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.orden(id) on delete cascade,
  monto          numeric(12,2) not null check (monto > 0),
  concepto       text not null check (concepto in ('Anticipo','Deducible','Saldo','Aseguradora')),
  metodo         text not null default 'Efectivo' check (metodo in ('Efectivo','Tarjeta','Transferencia')),
  op_id          uuid not null unique,  -- idempotencia
  registrado_por uuid references auth.users(id),
  creado_en      timestamptz not null default now()
);
create index on public.pago (orden_id);

-- ---------------------------------------------------------------------
-- Liquidación semanal (al cerrarse queda en solo lectura)
-- ---------------------------------------------------------------------
create table public.liquidacion (
  id                uuid primary key default gen_random_uuid(),
  semana_inicio     date not null unique check (extract(isodow from semana_inicio) = 1),
  estado            text not null default 'Cerrada' check (estado = 'Cerrada'),
  horas_vendidas    numeric(8,2) not null,
  horas_productivas numeric(8,2) not null,
  total_pagar       numeric(12,2) not null,
  cerrada_por       uuid references auth.users(id),
  cerrada_en        timestamptz not null default now(),
  op_id             uuid not null unique
);

create table public.liquidacion_detalle (
  liquidacion_id    uuid not null references public.liquidacion(id) on delete cascade,
  tecnico_id        uuid not null references public.tecnico(id),
  tecnico_nombre    text not null,
  horas_vendidas    numeric(8,2) not null,
  horas_productivas numeric(8,2) not null,
  tarifa_hora       numeric(10,2) not null,
  pago_base         numeric(12,2) not null,
  bono              numeric(12,2) not null,
  total             numeric(12,2) not null,
  primary key (liquidacion_id, tecnico_id)
);

create or replace function public._liquidacion_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'La liquidación está cerrada: solo lectura' using errcode = 'P0001';
end $$;
create trigger liquidacion_ro before update or delete on public.liquidacion
for each row execute function public._liquidacion_inmutable();
create trigger liquidacion_detalle_ro before update or delete on public.liquidacion_detalle
for each row execute function public._liquidacion_inmutable();

-- ---------------------------------------------------------------------
-- Registro de operaciones idempotentes (op_id generado por el cliente)
-- ---------------------------------------------------------------------
create table public.operacion (
  op_id      uuid primary key,
  tipo       text not null,
  user_id    uuid not null references auth.users(id),
  payload    jsonb,
  resultado  jsonb,
  creado_en  timestamptz not null default now()
);
