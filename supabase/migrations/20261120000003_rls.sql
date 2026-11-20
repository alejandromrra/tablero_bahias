-- =====================================================================
-- Tablero de bahías · Permisos y RLS
--
-- * RLS activada en TODAS las tablas.
-- * Nadie escribe directo en tablas: solo vía public.operar().
-- * Columnas de costo (tecnico.tarifa_hora, refaccion.costo) y el
--   deducible no se exponen por la API: se leen con funciones que
--   chequean el rol (tecnicos_admin, refacciones_listado, orden_finanzas).
-- * anon solo puede ejecutar consulta_publica(folio, placa).
-- =====================================================================

alter table public.config              enable row level security;
alter table public.config_finanzas     enable row level security;
alter table public.area                enable row level security;
alter table public.tecnico             enable row level security;
alter table public.perfil              enable row level security;
alter table public.catalogo_etapa      enable row level security;
alter table public.cliente             enable row level security;
alter table public.orden               enable row level security;
alter table public.pieza               enable row level security;
alter table public.etapa               enable row level security;
alter table public.bloque              enable row level security;
alter table public.registro_tiempo     enable row level security;
alter table public.refaccion           enable row level security;
alter table public.presupuesto         enable row level security;
alter table public.pago                enable row level security;
alter table public.liquidacion         enable row level security;
alter table public.liquidacion_detalle enable row level security;
alter table public.operacion           enable row level security;

-- ---------------------------------------------------------------------
-- Privilegios base: se parte de cero
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on public.config, public.config_finanzas, public.area, public.perfil, public.catalogo_etapa,
                public.cliente, public.pieza, public.etapa, public.bloque, public.registro_tiempo,
                public.presupuesto, public.pago, public.liquidacion, public.liquidacion_detalle
  to authenticated;
-- Columnas permitidas (sin costos ni deducible)
grant select (id, nombre, especialidades, horario, activo) on public.tecnico to authenticated;
grant select (id, folio, placa, cliente_id, tipo, aseguradora, estado, fecha_prometida, creado_por, creado_en)
  on public.orden to authenticated;
grant select (id, orden_id, nombre, precio_venta, estado, recibida_en, creado_en) on public.refaccion to authenticated;
grant select on public.v_orden_lista, public.v_planificador to authenticated;

grant execute on function public.mi_rol()                       to authenticated;
grant execute on function public.mi_tecnico_id()                to authenticated;
grant execute on function public.es_orden_del_tecnico(uuid)     to authenticated;
grant execute on function public.operar(uuid, text, jsonb)      to authenticated;
grant execute on function public.orden_finanzas(uuid)           to authenticated;
grant execute on function public.refacciones_listado()          to authenticated;
grant execute on function public.tecnicos_admin()               to authenticated;
grant execute on function public.liquidacion_semana(date)       to authenticated;
grant execute on function public.panel_gerencia(date)           to authenticated;
grant execute on function public.consulta_publica(text, text)   to anon, authenticated;

-- ---------------------------------------------------------------------
-- Políticas de lectura
-- ---------------------------------------------------------------------
create policy perfil_select on public.perfil for select to authenticated
  using (user_id = auth.uid() or public.mi_rol() = 'gerencia');

create policy config_select on public.config for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor'));

create policy config_finanzas_select on public.config_finanzas for select to authenticated
  using (public.mi_rol() = 'gerencia');

create policy area_select on public.area for select to authenticated
  using (public.mi_rol() is not null);

create policy catalogo_select on public.catalogo_etapa for select to authenticated
  using (public.mi_rol() is not null);

create policy tecnico_select on public.tecnico for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor') or id = public.mi_tecnico_id());

create policy cliente_select on public.cliente for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor'));

create policy orden_select on public.orden for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor') or public.es_orden_del_tecnico(id));

create policy pieza_select on public.pieza for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor') or public.es_orden_del_tecnico(orden_id));

create policy etapa_select on public.etapa for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor') or public.es_orden_del_tecnico(orden_id));

create policy bloque_select on public.bloque for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor') or tecnico_id = public.mi_tecnico_id());

create policy registro_select on public.registro_tiempo for select to authenticated
  using (public.mi_rol() = 'gerencia' or tecnico_id = public.mi_tecnico_id());

create policy refaccion_select on public.refaccion for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor'));

create policy presupuesto_select on public.presupuesto for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor'));

create policy pago_select on public.pago for select to authenticated
  using (public.mi_rol() in ('gerencia', 'asesor'));

create policy liquidacion_select on public.liquidacion for select to authenticated
  using (public.mi_rol() = 'gerencia');

create policy liquidacion_detalle_select on public.liquidacion_detalle for select to authenticated
  using (public.mi_rol() = 'gerencia');

-- operacion: sin políticas → nadie la lee ni escribe por la API.
