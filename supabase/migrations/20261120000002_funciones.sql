-- =====================================================================
-- Tablero de bahías · Funciones de BD
--
-- Toda escritura entra por public.operar(op_id, tipo, payload):
--   * corre en UNA transacción (la de la llamada RPC): si algo falla,
--     se revierte todo, incluido el registro de la operación;
--   * es idempotente por op_id: repetir el mismo op_id devuelve el
--     resultado guardado sin volver a escribir;
--   * valida rol y estado antes de tocar nada.
-- Las funciones _internas no son ejecutables desde la API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayudantes de sesión y tiempo
-- ---------------------------------------------------------------------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfil where user_id = auth.uid()
$$;

create or replace function public.mi_tecnico_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tecnico_id from public.perfil where user_id = auth.uid()
$$;

create or replace function public.es_orden_del_tecnico(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bloque b join public.etapa e on e.id = b.etapa_id
    where e.orden_id = p_orden and b.tecnico_id = public.mi_tecnico_id()
  )
$$;

create or replace function public._tz() returns text
language sql stable set search_path = public as $$
  select coalesce((select zona_horaria from public.config where id = 1), 'America/Mexico_City')
$$;

create or replace function public._semana_de(p_ts timestamptz) returns date
language sql stable set search_path = public as $$
  select date_trunc('week', p_ts at time zone public._tz())::date
$$;

create or replace function public._semana_cerrada(p_ts timestamptz) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.liquidacion where semana_inicio = public._semana_de(p_ts))
$$;

create or replace function public._fmt(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select to_char(p_ts at time zone public._tz(), 'DD/MM HH24:MI')
$$;

create or replace function public._hora(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select to_char(p_ts at time zone public._tz(), 'HH24:MI')
$$;

create or replace function public._mxn(p numeric) returns text
language sql immutable as $$
  select '$' || translate(to_char(coalesce(p, 0), 'FM999,999,990.00'), ',.', '.,')
$$;

create or replace function public._falla(p_msg text) returns void
language plpgsql as $$
begin
  raise exception '%', p_msg using errcode = 'P0001';
end $$;

-- Descripción legible de un bloque para mensajes de conflicto
create or replace function public._describir_bloque(p_bloque uuid) returns text
language sql stable set search_path = public as $$
  select b.folio || ' (' ||
    case when b.tipo = 'mantenimiento'
      then 'Mantenimiento' || coalesce(': ' || b.nota, '')
      else o.folio || ' · ' || ce.nombre ||
           case when e.tipo = 'pintura' then ' carga ' || e.carga else '' end ||
           ' · ' || t.nombre
    end || ') en ' || a.nombre || ', ' || public._fmt(b.inicio) || '–' || public._hora(b.fin) ||
    case when b.margen > 0 then ' +' || b.margen || ' min de margen' else '' end
  from public.bloque b
  join public.area a on a.id = b.area_id
  left join public.etapa e on e.id = b.etapa_id
  left join public.catalogo_etapa ce on ce.tipo = e.tipo
  left join public.orden o on o.id = e.orden_id
  left join public.tecnico t on t.id = b.tecnico_id
  where b.id = p_bloque
$$;

create or replace function public._lock(p_clave text) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtextextended(p_clave, 0))
$$;

-- ---------------------------------------------------------------------
-- Presupuesto y estado de la orden
-- ---------------------------------------------------------------------
create or replace function public._recalcular_presupuesto(p_orden uuid) returns public.presupuesto
language plpgsql set search_path = public as $$
declare
  c public.config;
  v_mo numeric; v_mat numeric; v_ref numeric; v_sub numeric; v_iva numeric; v_tot numeric;
  r public.presupuesto;
begin
  select * into c from public.config where id = 1;
  select round(coalesce(sum(e.horas), 0) * c.tarifa_mo, 2),
         round(coalesce(sum(e.horas * ce.material_hora), 0), 2)
    into v_mo, v_mat
    from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo
   where e.orden_id = p_orden;
  select coalesce(sum(precio_venta), 0) into v_ref from public.refaccion where orden_id = p_orden;
  v_sub := v_mo + v_mat + v_ref;
  v_iva := round(v_sub * c.iva, 2);
  v_tot := v_sub + v_iva;
  insert into public.presupuesto (orden_id, mano_obra, materiales, refacciones, subtotal, iva, total, anticipo, actualizado_en)
  values (p_orden, v_mo, v_mat, v_ref, v_sub, v_iva, v_tot, round(v_tot * c.anticipo_pct, 2), now())
  on conflict (orden_id) do update set
    mano_obra = excluded.mano_obra, materiales = excluded.materiales, refacciones = excluded.refacciones,
    subtotal = excluded.subtotal, iva = excluded.iva, total = excluded.total,
    anticipo = excluded.anticipo, actualizado_en = now()
  returning * into r;
  return r;
end $$;

create or replace function public._pagado(p_orden uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(monto), 0) from public.pago where orden_id = p_orden
$$;

-- Regla de programación: 50% de anticipo (particular) o presupuesto Autorizado (aseguradora)
create or replace function public._autorizada_para_programar(p_orden uuid) returns boolean
language sql stable set search_path = public as $$
  select coalesce((
    select case o.tipo
             when 'Particular'  then p.total > 0 and public._pagado(o.id) >= p.anticipo
             when 'Aseguradora' then p.estado = 'Autorizado'
           end
      from public.orden o join public.presupuesto p on p.orden_id = o.id
     where o.id = p_orden), false)
$$;

create or replace function public._recalcular_estado(p_orden uuid) returns text
language plpgsql set search_path = public as $$
declare
  v_estado text; v_pend boolean; v_nuevo text;
begin
  select estado into v_estado from public.orden where id = p_orden;
  if v_estado in ('Entregada', 'Cancelada') then return v_estado; end if;

  v_pend := exists (select 1 from public.refaccion where orden_id = p_orden and estado <> 'Recibida');

  -- Armado bloqueado mientras haya refacciones sin recibir
  update public.etapa e
     set estado = case
                    when v_pend then 'Bloqueada'
                    when exists (select 1 from public.bloque b where b.etapa_id = e.id) then 'Programada'
                    else 'Pendiente'
                  end
   where e.orden_id = p_orden and e.tipo = 'armado'
     and e.estado in ('Pendiente', 'Bloqueada', 'Programada');

  v_nuevo := case
    when not exists (select 1 from public.etapa where orden_id = p_orden and estado <> 'Terminada') then 'Terminada'
    when not public._autorizada_para_programar(p_orden)
         and not exists (select 1 from public.bloque b join public.etapa e on e.id = b.etapa_id where e.orden_id = p_orden)
      then 'Presupuesto'
    when v_pend then 'Esperando refacciones'
    else 'En proceso'
  end;

  update public.orden set estado = v_nuevo where id = p_orden and estado is distinct from v_nuevo;
  return v_nuevo;
end $$;

-- ---------------------------------------------------------------------
-- Conflictos de recursos
-- ---------------------------------------------------------------------
create or replace function public._conflicto(p_recurso text, p_bloque uuid) returns void
language plpgsql set search_path = public as $$
declare v_desc text; v_folio text;
begin
  select folio into v_folio from public.bloque where id = p_bloque;
  v_desc := public._describir_bloque(p_bloque);
  raise exception '%', 'Conflicto: ' ||
      case when p_recurso = 'tecnico' then 'el técnico ya tiene el bloque ' else 'el área ya está ocupada por el bloque ' end ||
      coalesce(v_desc, 'tomado por otra sesión') || '.'
    using errcode = 'PT409',
          detail  = jsonb_build_object('recurso', p_recurso, 'bloque_id', p_bloque, 'folio', v_folio)::text,
          hint    = 'CONFLICTO';
end $$;

-- Busca solape para el técnico y un slot libre en el área.
-- Devuelve slot libre (o null) y, si hay, el bloque que choca.
create or replace function public._buscar_conflicto(
  p_area uuid, p_tecnico uuid, p_rng_area tstzrange, p_rng_tec tstzrange,
  out recurso text, out bloque_id uuid, out slot_libre int)
language plpgsql stable set search_path = public as $$
declare v_cap int; s int;
begin
  if p_tecnico is not null then
    select b.id into bloque_id from public.bloque b
     where b.tecnico_id = p_tecnico and b.periodo_tecnico && p_rng_tec
     order by b.inicio limit 1;
    if bloque_id is not null then recurso := 'tecnico'; return; end if;
  end if;
  select capacidad into v_cap from public.area where id = p_area;
  for s in 1..v_cap loop
    if not exists (select 1 from public.bloque b where b.area_id = p_area and b.slot = s and b.periodo_area && p_rng_area) then
      slot_libre := s; return;
    end if;
  end loop;
  select b.id into bloque_id from public.bloque b
   where b.area_id = p_area and b.periodo_area && p_rng_area
   order by b.inicio limit 1;
  recurso := 'area';
end $$;

-- ---------------------------------------------------------------------
-- Operaciones internas
-- ---------------------------------------------------------------------
create or replace function public._crear_orden(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare
  c public.config;
  v_tipo text := p->>'tipo';
  v_placa text := upper(regexp_replace(coalesce(p->>'placa', ''), '\s', '', 'g'));
  v_ded numeric := coalesce(nullif(p->>'deducible', '')::numeric, 0);
  v_piezas jsonb := coalesce(p->'piezas', '[]'::jsonb);
  v_cli uuid; v_ord public.orden; ce record; v_horas numeric; v_n int; r record;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor pueden crear órdenes'); end if;
  select * into c from public.config where id = 1;
  if v_tipo is null or v_tipo not in ('Particular', 'Aseguradora') then perform public._falla('Tipo de orden inválido (Particular o Aseguradora)'); end if;
  if v_placa !~ '^[A-Z0-9-]{3,12}$' then perform public._falla('Placa inválida'); end if;
  if nullif(p->>'fecha_prometida', '') is null then perform public._falla('Falta la fecha prometida'); end if;
  if v_ded < 0 then perform public._falla('El deducible no puede ser negativo'); end if;
  if v_tipo = 'Particular' and v_ded <> 0 then perform public._falla('El deducible solo aplica a órdenes de aseguradora'); end if;
  if v_tipo = 'Aseguradora' and coalesce(trim(p->>'aseguradora'), '') = '' then perform public._falla('Indicá la aseguradora'); end if;
  if jsonb_typeof(v_piezas) <> 'array' or jsonb_array_length(v_piezas) = 0 then perform public._falla('Agregá al menos una pieza con daño'); end if;
  if exists (select 1 from jsonb_array_elements(v_piezas) x
              where coalesce(trim(x->>'nombre'), '') = '' or coalesce(x->>'dano', '') not in ('Leve','Medio','Fuerte','Reemplazo')) then
    perform public._falla('Cada pieza necesita nombre y daño (Leve, Medio, Fuerte o Reemplazo)');
  end if;

  if nullif(p->>'cliente_id', '') is not null then
    select id into v_cli from public.cliente where id = (p->>'cliente_id')::uuid;
    if v_cli is null then perform public._falla('Cliente inexistente'); end if;
  else
    if coalesce(trim(p#>>'{cliente,nombre}'), '') = '' then perform public._falla('Falta el nombre del cliente'); end if;
    insert into public.cliente (nombre, telefono, email)
    values (trim(p#>>'{cliente,nombre}'), nullif(trim(p#>>'{cliente,telefono}'), ''), nullif(trim(p#>>'{cliente,email}'), ''))
    returning id into v_cli;
  end if;

  insert into public.orden (placa, cliente_id, tipo, aseguradora, fecha_prometida, deducible, creado_por)
  values (v_placa, v_cli, v_tipo, case when v_tipo = 'Aseguradora' then trim(p->>'aseguradora') end,
          (p->>'fecha_prometida')::timestamptz, v_ded, p_uid)
  returning * into v_ord;

  insert into public.pieza (orden_id, nombre, dano)
  select v_ord.id, trim(x->>'nombre'), x->>'dano'
    from jsonb_array_elements(v_piezas) with ordinality as t(x, n) order by n;

  -- Etapas desde el catálogo; la pintura se parte en cargas de cabina
  for ce in select * from public.catalogo_etapa order by secuencia loop
    for r in
      select case when ce.tipo = 'pintura' then ((n - 1) / c.cabina_max_piezas) + 1 else 1 end as carga,
             sum(case x->>'dano' when 'Leve' then ce.h_leve when 'Medio' then ce.h_medio
                                 when 'Fuerte' then ce.h_fuerte else ce.h_reemplazo end) as horas,
             count(*)::int as piezas
        from jsonb_array_elements(v_piezas) with ordinality as t(x, n)
       group by 1 order by 1
    loop
      if r.horas > 0 then
        insert into public.etapa (orden_id, tipo, secuencia, carga, area_tipo, especialidad, horas, piezas)
        values (v_ord.id, ce.tipo, ce.secuencia, r.carga, ce.area_tipo, ce.especialidad, r.horas, r.piezas);
      end if;
    end loop;
  end loop;

  if not exists (select 1 from public.etapa where orden_id = v_ord.id) then
    perform public._falla('Las piezas no generan horas de trabajo con el catálogo actual');
  end if;

  perform public._recalcular_presupuesto(v_ord.id);
  perform public._recalcular_estado(v_ord.id);
  return jsonb_build_object('orden_id', v_ord.id, 'folio', v_ord.folio);
end $$;

create or replace function public._programar_bloque(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare
  c public.config;
  v_tz text := public._tz();
  v_etapa public.etapa; v_orden public.orden; v_tec public.tecnico; v_area public.area;
  v_nombre_etapa text;
  v_ini timestamptz; v_margen int; v_dur interval; v_fin_tec timestamptz; v_fin timestamptz;
  l_ini timestamp; l_fin timestamp; l_fin_tec timestamp; v_dia date; v_isodow int;
  v_prev_sec int; v_falta text; v_prev record; v_next record; v_pint record;
  v_rng_area tstzrange; v_rng_tec tstzrange; v_conf record; v_bloque public.bloque;
  v_pend int; k1 bigint; k2 bigint; v_pagado numeric; v_pres public.presupuesto;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor pueden programar bloques'); end if;
  select * into c from public.config where id = 1;

  select * into v_etapa from public.etapa where id = (p->>'etapa_id')::uuid;
  if v_etapa.id is null then perform public._falla('Etapa inexistente'); end if;
  -- Serializa la programación de una misma orden
  select * into v_orden from public.orden where id = v_etapa.orden_id for update;
  select * into v_etapa from public.etapa where id = v_etapa.id for update;
  select nombre into v_nombre_etapa from public.catalogo_etapa where tipo = v_etapa.tipo;

  if v_orden.estado in ('Terminada', 'Entregada', 'Cancelada') then
    perform public._falla('La orden ' || v_orden.folio || ' está ' || v_orden.estado);
  end if;

  -- Anticipo / autorización
  if not public._autorizada_para_programar(v_orden.id) then
    select * into v_pres from public.presupuesto where orden_id = v_orden.id;
    if v_orden.tipo = 'Particular' then
      v_pagado := public._pagado(v_orden.id);
      perform public._falla(format('No se puede programar %s: falta el anticipo del 50%% (pagado %s de %s)',
                            v_orden.folio, public._mxn(v_pagado), public._mxn(v_pres.anticipo)));
    else
      perform public._falla('No se puede programar ' || v_orden.folio || ': el presupuesto de la aseguradora no está Autorizado');
    end if;
  end if;

  -- Estado de la etapa
  select count(*) into v_pend from public.refaccion where orden_id = v_orden.id and estado <> 'Recibida';
  if v_etapa.tipo = 'armado' and v_pend > 0 then
    perform public._falla(format('Armado bloqueado: hay %s refacción(es) sin recibir en %s', v_pend, v_orden.folio));
  end if;
  if v_etapa.estado <> 'Pendiente' then
    perform public._falla(coalesce(
      (select 'La etapa ya está programada en el bloque ' || b.folio from public.bloque b where b.etapa_id = v_etapa.id),
      'La etapa está ' || v_etapa.estado));
  end if;

  -- Técnico y área
  select * into v_tec from public.tecnico where id = (p->>'tecnico_id')::uuid;
  if v_tec.id is null or not v_tec.activo then perform public._falla('Técnico inexistente o inactivo'); end if;
  if not (v_etapa.especialidad = any (v_tec.especialidades)) then
    perform public._falla(format('%s no tiene la especialidad «%s» que requiere %s', v_tec.nombre, v_etapa.especialidad, v_nombre_etapa));
  end if;
  select * into v_area from public.area where id = (p->>'area_id')::uuid;
  if v_area.id is null or not v_area.activa then perform public._falla('Área inexistente o inactiva'); end if;
  if v_area.tipo <> v_etapa.area_tipo then
    perform public._falla(format('%s no se puede hacer en %s (requiere un área de tipo %s)', v_nombre_etapa, v_area.nombre, v_etapa.area_tipo));
  end if;
  if v_etapa.tipo = 'pintura' and v_etapa.piezas > c.cabina_max_piezas then
    perform public._falla(format('La cabina admite máximo %s piezas por carga (esta carga tiene %s)', c.cabina_max_piezas, v_etapa.piezas));
  end if;

  -- Tiempo
  if nullif(p->>'inicio', '') is null then perform public._falla('Falta el inicio'); end if;
  v_ini := (p->>'inicio')::timestamptz;
  v_margen := coalesce(nullif(p->>'margen', '')::int, c.margen_default_min);
  if v_margen < 0 or v_margen > 240 then perform public._falla('El margen debe estar entre 0 y 240 minutos'); end if;
  l_ini := v_ini at time zone v_tz;
  if extract(second from l_ini) <> 0 or extract(minute from l_ini)::int not in (0, 30) then
    perform public._falla('El inicio tiene que caer en un bloque de 30 minutos (:00 o :30)');
  end if;
  v_dur := make_interval(mins => (ceil(v_etapa.horas * 2) * 30)::int);
  v_fin_tec := v_ini + v_dur;
  v_fin := v_fin_tec + case when v_etapa.tipo = 'pintura' then make_interval(mins => (c.horneado_horas * 60)::int) else interval '0' end;
  l_fin := v_fin at time zone v_tz;
  l_fin_tec := v_fin_tec at time zone v_tz;
  v_dia := l_ini::date;
  v_isodow := extract(isodow from v_dia)::int;

  if not (v_isodow = any (c.dias_laborables)) or l_ini < v_dia + c.apertura or l_fin > v_dia + c.cierre then
    perform public._falla(format('El bloque (%s–%s) queda fuera del horario del taller (%s–%s)',
      to_char(l_ini, 'DD/MM HH24:MI'), to_char(l_fin, 'HH24:MI'), to_char(c.apertura, 'HH24:MI'), to_char(c.cierre, 'HH24:MI')));
  end if;
  if not ((v_tec.horario->'dias') @> to_jsonb(v_isodow))
     or l_ini < v_dia + (v_tec.horario->>'inicio')::time
     or l_fin_tec > v_dia + (v_tec.horario->>'fin')::time then
    perform public._falla(format('%s no trabaja en ese horario (%s–%s)', v_tec.nombre, v_tec.horario->>'inicio', v_tec.horario->>'fin'));
  end if;
  if public._semana_cerrada(v_ini) then perform public._falla('Esa semana ya está liquidada: solo lectura'); end if;

  -- Secuencia: la etapa anterior tiene que terminar antes (o justo al) inicio
  select max(secuencia) into v_prev_sec from public.etapa where orden_id = v_orden.id and secuencia < v_etapa.secuencia;
  if v_prev_sec is not null then
    select string_agg(ce.nombre || case when e.tipo = 'pintura' then ' carga ' || e.carga else '' end, ', ')
      into v_falta
      from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo
      left join public.bloque b on b.etapa_id = e.id
     where e.orden_id = v_orden.id and e.secuencia = v_prev_sec and b.id is null;
    if v_falta is not null then
      perform public._falla('La etapa anterior (' || v_falta || ') todavía no está programada');
    end if;
    select b.folio, b.fin, ce.nombre into v_prev
      from public.etapa e join public.bloque b on b.etapa_id = e.id join public.catalogo_etapa ce on ce.tipo = e.tipo
     where e.orden_id = v_orden.id and e.secuencia = v_prev_sec
     order by b.fin desc limit 1;
    if v_prev.fin > v_ini then
      perform public._falla(format('La etapa anterior (%s, bloque %s) termina %s, después del inicio solicitado %s',
        v_prev.nombre, v_prev.folio, public._fmt(v_prev.fin), public._fmt(v_ini)));
    end if;
  end if;

  -- Curado: 12 h calendario entre el fin de pintura (con horneado) y el pulido
  if v_etapa.tipo = 'pulido' then
    select b.folio, b.fin into v_pint
      from public.etapa e join public.bloque b on b.etapa_id = e.id
     where e.orden_id = v_orden.id and e.tipo = 'pintura' order by b.fin desc limit 1;
    if v_pint.fin is not null and v_ini < v_pint.fin + make_interval(mins => (c.curado_horas * 60)::int) then
      perform public._falla(format('Curado: el pulido puede empezar desde %s (%s h calendario después de la pintura %s, cuenta el taller cerrado)',
        public._fmt(v_pint.fin + make_interval(mins => (c.curado_horas * 60)::int)), trim_scale(c.curado_horas)::text, v_pint.folio));
    end if;
  end if;

  -- Coherencia con etapas posteriores ya programadas
  select b.folio, b.inicio, ce.nombre, e.tipo into v_next
    from public.etapa e join public.bloque b on b.etapa_id = e.id join public.catalogo_etapa ce on ce.tipo = e.tipo
   where e.orden_id = v_orden.id and e.secuencia > v_etapa.secuencia
     and b.inicio < v_fin + case when v_etapa.tipo = 'pintura' and e.tipo = 'pulido'
                                 then make_interval(mins => (c.curado_horas * 60)::int) else interval '0' end
   order by b.inicio limit 1;
  if v_next.folio is not null then
    perform public._falla(format('La etapa siguiente (%s, bloque %s) ya está programada %s; este bloque terminaría después',
      v_next.nombre, v_next.folio, public._fmt(v_next.inicio)));
  end if;

  -- Recursos: bloqueo en orden fijo y verificación de solapes
  k1 := hashtextextended('area:' || v_area.id, 0);
  k2 := hashtextextended('tecnico:' || v_tec.id, 0);
  if k1 < k2 then perform pg_advisory_xact_lock(k1); perform pg_advisory_xact_lock(k2);
  else perform pg_advisory_xact_lock(k2); perform pg_advisory_xact_lock(k1); end if;

  v_rng_area := tstzrange(v_ini, v_fin + make_interval(mins => v_margen), '[)');
  v_rng_tec  := tstzrange(v_ini, v_fin_tec + make_interval(mins => v_margen), '[)');
  select * into v_conf from public._buscar_conflicto(v_area.id, v_tec.id, v_rng_area, v_rng_tec);
  if v_conf.bloque_id is not null or v_conf.slot_libre is null then
    perform public._conflicto(v_conf.recurso, v_conf.bloque_id);
  end if;

  begin
    insert into public.bloque (tipo, etapa_id, tecnico_id, area_id, slot, inicio, fin, fin_tecnico, margen, creado_por)
    values ('trabajo', v_etapa.id, v_tec.id, v_area.id, v_conf.slot_libre, v_ini, v_fin, v_fin_tec, v_margen, p_uid)
    returning * into v_bloque;
  exception when exclusion_violation then
    -- Red de seguridad: la restricción EXCLUDE ganó la carrera
    select * into v_conf from public._buscar_conflicto(v_area.id, v_tec.id, v_rng_area, v_rng_tec);
    perform public._conflicto(coalesce(v_conf.recurso, 'area'), v_conf.bloque_id);
  end;

  update public.etapa set estado = 'Programada', area_id = v_area.id where id = v_etapa.id;
  perform public._recalcular_estado(v_orden.id);

  return jsonb_build_object('bloque_id', v_bloque.id, 'folio', v_bloque.folio, 'inicio', v_bloque.inicio,
                            'fin', v_bloque.fin, 'fin_tecnico', v_bloque.fin_tecnico, 'slot', v_bloque.slot);
end $$;

create or replace function public._cancelar_bloque(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_b public.bloque; v_e public.etapa; v_next text;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor pueden desprogramar'); end if;
  select * into v_b from public.bloque where id = (p->>'bloque_id')::uuid;
  if v_b.id is null then perform public._falla('Bloque inexistente'); end if;
  if v_b.tipo = 'mantenimiento' and p_rol <> 'gerencia' then perform public._falla('Solo gerencia gestiona mantenimientos'); end if;
  if v_b.etapa_id is not null then
    perform 1 from public.orden o join public.etapa e on e.orden_id = o.id where e.id = v_b.etapa_id for update of o;
  end if;
  select * into v_b from public.bloque where id = v_b.id for update;
  if public._semana_cerrada(v_b.inicio) then perform public._falla('Esa semana ya está liquidada: solo lectura'); end if;
  if v_b.tipo = 'trabajo' then
    select * into v_e from public.etapa where id = v_b.etapa_id for update;
    if v_e.estado not in ('Programada', 'Bloqueada') then
      perform public._falla('No se puede desprogramar una etapa ' || v_e.estado);
    end if;
    select b.folio into v_next from public.etapa e join public.bloque b on b.etapa_id = e.id
     where e.orden_id = v_e.orden_id and e.secuencia > v_e.secuencia order by b.inicio limit 1;
    if v_next is not null then perform public._falla('Primero desprogramá la etapa siguiente (bloque ' || v_next || ')'); end if;
  end if;
  delete from public.bloque where id = v_b.id;
  if v_b.tipo = 'trabajo' then
    update public.etapa set estado = 'Pendiente', area_id = null where id = v_e.id;
    perform public._recalcular_estado(v_e.orden_id);
  end if;
  return jsonb_build_object('bloque_id', v_b.id, 'folio', v_b.folio);
end $$;

create or replace function public._programar_mantenimiento(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_area public.area; v_ini timestamptz; v_fin timestamptz; s int; v_rng tstzrange; v_conf uuid;
  v_folios text[] := '{}'; v_f text; l timestamp;
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia programa mantenimientos'); end if;
  select * into v_area from public.area where id = (p->>'area_id')::uuid;
  if v_area.id is null then perform public._falla('Área inexistente'); end if;
  v_ini := (p->>'inicio')::timestamptz; v_fin := (p->>'fin')::timestamptz;
  if v_ini is null or v_fin is null or v_fin <= v_ini then perform public._falla('Rango de mantenimiento inválido'); end if;
  foreach l in array array[v_ini at time zone public._tz(), v_fin at time zone public._tz()] loop
    if extract(second from l) <> 0 or extract(minute from l)::int not in (0, 30) then
      perform public._falla('El mantenimiento tiene que alinearse a bloques de 30 minutos');
    end if;
  end loop;
  if public._semana_cerrada(v_ini) then perform public._falla('Esa semana ya está liquidada: solo lectura'); end if;
  perform public._lock('area:' || v_area.id);
  v_rng := tstzrange(v_ini, v_fin, '[)');
  for s in 1..v_area.capacidad loop
    select b.id into v_conf from public.bloque b where b.area_id = v_area.id and b.slot = s and b.periodo_area && v_rng order by b.inicio limit 1;
    if v_conf is not null then perform public._conflicto('area', v_conf); end if;
    insert into public.bloque (tipo, area_id, slot, inicio, fin, margen, nota, creado_por)
    values ('mantenimiento', v_area.id, s, v_ini, v_fin, 0, nullif(trim(p->>'nota'), ''), p_uid)
    returning folio into v_f;
    v_folios := v_folios || v_f;
  end loop;
  return jsonb_build_object('folios', to_jsonb(v_folios));
end $$;

create or replace function public._etapa_accion(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare
  c public.config; v_e public.etapa; v_b public.bloque; v_acc text := p->>'accion';
  v_falta text; v_otra text; v_pint timestamptz; v_desde timestamptz; v_ord uuid;
begin
  select * into c from public.config where id = 1;
  select orden_id into v_ord from public.etapa where id = (p->>'etapa_id')::uuid;
  if v_ord is null then perform public._falla('Etapa inexistente'); end if;
  perform 1 from public.orden where id = v_ord for update;
  select * into v_e from public.etapa where id = (p->>'etapa_id')::uuid for update;
  select * into v_b from public.bloque where etapa_id = v_e.id;
  if v_b.id is null then perform public._falla('La etapa no está programada'); end if;
  if p_rol = 'tecnico' then
    if v_b.tecnico_id is distinct from public.mi_tecnico_id() then perform public._falla('Ese bloque no es tuyo'); end if;
  elsif p_rol <> 'gerencia' then
    perform public._falla('Solo el técnico asignado o gerencia cambian el avance');
  end if;
  if public._semana_cerrada(now()) or public._semana_cerrada(v_b.inicio) then
    perform public._falla('La semana ya está liquidada: solo lectura');
  end if;

  if v_acc = 'iniciar' then
    if v_e.estado = 'Bloqueada' then perform public._falla('Armado bloqueado: hay refacciones sin recibir'); end if;
    if v_e.estado not in ('Programada', 'Pausada') then perform public._falla('No se puede iniciar una etapa ' || v_e.estado); end if;
    select string_agg(distinct ce.nombre, ', ') into v_falta
      from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo
     where e.orden_id = v_e.orden_id and e.secuencia < v_e.secuencia and e.estado <> 'Terminada';
    if v_falta is not null then perform public._falla('Primero tiene que terminarse: ' || v_falta); end if;
    if v_e.tipo = 'pulido' then
      select max(terminada_en) into v_pint from public.etapa where orden_id = v_e.orden_id and tipo = 'pintura';
      v_desde := v_pint + make_interval(mins => ((c.horneado_horas + c.curado_horas) * 60)::int);
      if now() < v_desde then perform public._falla('Curado en curso: se puede pulir desde ' || public._fmt(v_desde)); end if;
    end if;
    select o.folio || ' · ' || ce.nombre into v_otra
      from public.etapa e join public.bloque b on b.etapa_id = e.id join public.orden o on o.id = e.orden_id
      join public.catalogo_etapa ce on ce.tipo = e.tipo
     where b.tecnico_id = v_b.tecnico_id and e.estado = 'En curso' and e.id <> v_e.id limit 1;
    if v_otra is not null then perform public._falla('Ya hay otra etapa en curso (' || v_otra || '). Pausala o terminala primero.'); end if;
    update public.etapa set estado = 'En curso', iniciada_en = coalesce(iniciada_en, now()) where id = v_e.id;
    insert into public.registro_tiempo (etapa_id, tecnico_id, inicio) values (v_e.id, v_b.tecnico_id, now());
  elsif v_acc = 'pausar' then
    if v_e.estado <> 'En curso' then perform public._falla('Solo se pausa una etapa En curso'); end if;
    update public.etapa set estado = 'Pausada' where id = v_e.id;
    update public.registro_tiempo set fin = now() where etapa_id = v_e.id and fin is null;
  elsif v_acc = 'terminar' then
    if v_e.estado not in ('En curso', 'Pausada') then perform public._falla('Solo se termina una etapa En curso o Pausada'); end if;
    update public.etapa set estado = 'Terminada', terminada_en = now() where id = v_e.id;
    update public.registro_tiempo set fin = now() where etapa_id = v_e.id and fin is null;
  else
    perform public._falla('Acción inválida');
  end if;
  perform public._recalcular_estado(v_e.orden_id);
  return jsonb_build_object('etapa_id', v_e.id, 'estado', (select estado from public.etapa where id = v_e.id));
end $$;

create or replace function public._registrar_pago(p jsonb, p_uid uuid, p_rol text, p_op uuid) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_o public.orden; v_pr public.presupuesto; v_monto numeric; v_conc text := p->>'concepto';
  v_pagado numeric; v_ded_pagado numeric; v_id uuid;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor registran pagos'); end if;
  select * into v_o from public.orden where id = (p->>'orden_id')::uuid for update;
  if v_o.id is null then perform public._falla('Orden inexistente'); end if;
  if v_o.estado = 'Cancelada' then perform public._falla('La orden está cancelada'); end if;
  v_monto := nullif(p->>'monto', '')::numeric;
  if v_monto is null or v_monto <= 0 then perform public._falla('El monto tiene que ser mayor a cero'); end if;
  if v_monto <> round(v_monto, 2) then perform public._falla('El monto admite como máximo 2 decimales'); end if;
  if v_o.tipo = 'Particular' and coalesce(v_conc, '') not in ('Anticipo', 'Saldo') then
    perform public._falla('En órdenes particulares el pago es Anticipo o Saldo');
  end if;
  if v_o.tipo = 'Aseguradora' and coalesce(v_conc, '') not in ('Deducible', 'Aseguradora', 'Saldo') then
    perform public._falla('En órdenes de aseguradora el pago es Deducible, Aseguradora o Saldo');
  end if;
  if coalesce(p->>'metodo', 'Efectivo') not in ('Efectivo', 'Tarjeta', 'Transferencia') then perform public._falla('Método de pago inválido'); end if;
  select * into v_pr from public.presupuesto where orden_id = v_o.id;
  v_pagado := public._pagado(v_o.id);
  if v_pagado + v_monto > v_pr.total then
    perform public._falla(format('El pago excede el saldo pendiente (%s)', public._mxn(v_pr.total - v_pagado)));
  end if;
  if v_conc = 'Deducible' then
    select coalesce(sum(monto), 0) into v_ded_pagado from public.pago where orden_id = v_o.id and concepto = 'Deducible';
    if v_ded_pagado + v_monto > v_o.deducible then
      perform public._falla(format('El deducible pendiente es %s', public._mxn(v_o.deducible - v_ded_pagado)));
    end if;
  end if;
  insert into public.pago (orden_id, monto, concepto, metodo, op_id, registrado_por)
  values (v_o.id, v_monto, v_conc, coalesce(p->>'metodo', 'Efectivo'), p_op, p_uid)
  returning id into v_id;
  perform public._recalcular_estado(v_o.id);
  v_pagado := v_pagado + v_monto;
  return jsonb_build_object('pago_id', v_id, 'pagado', v_pagado, 'saldo', v_pr.total - v_pagado,
                            'autorizada_para_programar', public._autorizada_para_programar(v_o.id));
end $$;

create or replace function public._autorizar_presupuesto(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_o public.orden; v_pr public.presupuesto;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor autorizan presupuestos'); end if;
  select * into v_o from public.orden where id = (p->>'orden_id')::uuid for update;
  if v_o.id is null then perform public._falla('Orden inexistente'); end if;
  if v_o.tipo <> 'Aseguradora' then perform public._falla('Solo las órdenes de aseguradora requieren autorización (las particulares se habilitan con el anticipo)'); end if;
  select * into v_pr from public.presupuesto where orden_id = v_o.id for update;
  if v_pr.estado = 'Autorizado' then perform public._falla('El presupuesto ya está Autorizado'); end if;
  update public.presupuesto set estado = 'Autorizado', autorizado_por = p_uid, autorizado_en = now() where orden_id = v_o.id;
  perform public._recalcular_estado(v_o.id);
  return jsonb_build_object('orden_id', v_o.id, 'estado', 'Autorizado');
end $$;

create or replace function public._alta_refaccion(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_o public.orden; v_costo numeric; v_mk numeric; v_id uuid; v_precio numeric;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor dan de alta refacciones'); end if;
  select * into v_o from public.orden where id = (p->>'orden_id')::uuid for update;
  if v_o.id is null then perform public._falla('Orden inexistente'); end if;
  if v_o.estado in ('Terminada', 'Entregada', 'Cancelada') then perform public._falla('La orden está ' || v_o.estado); end if;
  if exists (select 1 from public.etapa where orden_id = v_o.id and tipo = 'armado' and estado in ('En curso', 'Pausada', 'Terminada')) then
    perform public._falla('El armado ya empezó: no se pueden agregar refacciones');
  end if;
  if coalesce(trim(p->>'nombre'), '') = '' then perform public._falla('Falta el nombre de la refacción'); end if;
  v_costo := nullif(p->>'costo', '')::numeric;
  if v_costo is null or v_costo <= 0 then perform public._falla('El costo tiene que ser mayor a cero'); end if;
  select markup_refacciones into v_mk from public.config_finanzas where id = 1;
  v_precio := round(v_costo * (1 + v_mk), 2);
  insert into public.refaccion (orden_id, nombre, costo, precio_venta) values (v_o.id, trim(p->>'nombre'), round(v_costo, 2), v_precio)
  returning id into v_id;
  perform public._recalcular_presupuesto(v_o.id);
  perform public._recalcular_estado(v_o.id);
  return jsonb_build_object('refaccion_id', v_id, 'precio_venta', v_precio);
end $$;

create or replace function public._recibir_refaccion(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_r public.refaccion; v_pend int; v_estado text;
begin
  if p_rol not in ('gerencia', 'asesor') then perform public._falla('Solo gerencia o asesor reciben refacciones'); end if;
  select * into v_r from public.refaccion where id = (p->>'refaccion_id')::uuid;
  if v_r.id is null then perform public._falla('Refacción inexistente'); end if;
  perform 1 from public.orden where id = v_r.orden_id for update;
  select * into v_r from public.refaccion where id = v_r.id for update;
  if v_r.estado = 'Recibida' then perform public._falla('La refacción ya estaba Recibida'); end if;
  update public.refaccion set estado = 'Recibida', recibida_en = now() where id = v_r.id;
  v_estado := public._recalcular_estado(v_r.orden_id);
  select count(*) into v_pend from public.refaccion where orden_id = v_r.orden_id and estado <> 'Recibida';
  return jsonb_build_object('refaccion_id', v_r.id, 'pendientes', v_pend, 'orden_estado', v_estado);
end $$;

-- Cálculo de liquidación (sin escrituras)
create or replace function public._liquidacion_calculo(p_semana date)
returns table (tecnico_id uuid, tecnico_nombre text, horas_vendidas numeric, horas_productivas numeric,
               tarifa_hora numeric, pago_base numeric, bono numeric, total numeric)
language sql stable set search_path = public as $$
  with lim as (
    select (p_semana::timestamp at time zone public._tz()) as lo,
           ((p_semana + 7)::timestamp at time zone public._tz()) as hi
  ), f as (select * from public.config_finanzas where id = 1),
  calc as (
    select t.id, t.nombre, t.tarifa_hora,
      coalesce((select sum(e.horas) from public.etapa e join public.bloque b on b.etapa_id = e.id, lim
                 where b.tecnico_id = t.id and e.estado = 'Terminada' and e.terminada_en >= lim.lo and e.terminada_en < lim.hi), 0) as vend,
      coalesce((select sum(extract(epoch from (least(coalesce(r.fin, now()), lim.hi) - greatest(r.inicio, lim.lo))) / 3600)
                  from public.registro_tiempo r, lim
                 where r.tecnico_id = t.id and r.inicio < lim.hi and coalesce(r.fin, now()) > lim.lo), 0) as prod
    from public.tecnico t
  )
  select calc.id, calc.nombre, round(vend, 2), round(prod, 2), calc.tarifa_hora,
         round(vend * calc.tarifa_hora, 2),
         round(greatest(vend - f.umbral_bono_horas, 0) * f.bono_hora, 2),
         round(vend * calc.tarifa_hora, 2) + round(greatest(vend - f.umbral_bono_horas, 0) * f.bono_hora, 2)
  from calc, f
  order by calc.nombre
$$;

create or replace function public._cerrar_liquidacion(p jsonb, p_uid uuid, p_rol text, p_op uuid) returns jsonb
language plpgsql set search_path = public as $$
declare v_sem date; v_id uuid; v_curso text; v_hv numeric; v_hp numeric; v_tot numeric;
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia cierra la liquidación'); end if;
  v_sem := nullif(p->>'semana_inicio', '')::date;
  if v_sem is null or extract(isodow from v_sem) <> 1 then perform public._falla('La semana tiene que empezar en lunes'); end if;
  if v_sem > public._semana_de(now()) then perform public._falla('No se puede cerrar una semana futura'); end if;
  perform public._lock('liquidacion:' || v_sem);
  if exists (select 1 from public.liquidacion where semana_inicio = v_sem) then
    perform public._falla('La liquidación de la semana ' || to_char(v_sem, 'DD/MM/YYYY') || ' ya está cerrada');
  end if;
  select string_agg(o.folio || ' · ' || ce.nombre, ', ') into v_curso
    from public.etapa e join public.bloque b on b.etapa_id = e.id join public.orden o on o.id = e.orden_id
    join public.catalogo_etapa ce on ce.tipo = e.tipo
   where e.estado = 'En curso' and public._semana_de(b.inicio) = v_sem;
  if v_curso is not null then perform public._falla('No se puede cerrar: hay etapas En curso (' || v_curso || ')'); end if;
  if exists (select 1 from public.registro_tiempo r where r.fin is null and public._semana_de(r.inicio) = v_sem) then
    perform public._falla('No se puede cerrar: hay tiempo abierto de técnicos en esa semana');
  end if;

  select coalesce(sum(horas_vendidas), 0), coalesce(sum(horas_productivas), 0), coalesce(sum(total), 0)
    into v_hv, v_hp, v_tot from public._liquidacion_calculo(v_sem);
  insert into public.liquidacion (semana_inicio, horas_vendidas, horas_productivas, total_pagar, cerrada_por, op_id)
  values (v_sem, v_hv, v_hp, v_tot, p_uid, p_op) returning id into v_id;
  insert into public.liquidacion_detalle (liquidacion_id, tecnico_id, tecnico_nombre, horas_vendidas, horas_productivas, tarifa_hora, pago_base, bono, total)
  select v_id, l.* from public._liquidacion_calculo(v_sem) l;
  return jsonb_build_object('liquidacion_id', v_id, 'semana_inicio', v_sem, 'horas_vendidas', v_hv, 'total_pagar', v_tot);
end $$;

create or replace function public._guardar_config(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := coalesce(p->'config', '{}'); fin jsonb := coalesce(p->'finanzas', '{}');
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia edita la configuración'); end if;
  update public.config set
    tarifa_mo          = coalesce((cfg->>'tarifa_mo')::numeric, tarifa_mo),
    iva                = coalesce((cfg->>'iva')::numeric, iva),
    anticipo_pct       = coalesce((cfg->>'anticipo_pct')::numeric, anticipo_pct),
    curado_horas       = coalesce((cfg->>'curado_horas')::numeric, curado_horas),
    horneado_horas     = coalesce((cfg->>'horneado_horas')::numeric, horneado_horas),
    cabina_max_piezas  = coalesce((cfg->>'cabina_max_piezas')::int, cabina_max_piezas),
    apertura           = coalesce((cfg->>'apertura')::time, apertura),
    cierre             = coalesce((cfg->>'cierre')::time, cierre),
    dias_laborables    = coalesce((select array_agg(x::int) from jsonb_array_elements_text(cfg->'dias_laborables') x), dias_laborables),
    margen_default_min = coalesce((cfg->>'margen_default_min')::int, margen_default_min),
    actualizado_en     = now()
  where id = 1;
  update public.config_finanzas set
    markup_refacciones = coalesce((fin->>'markup_refacciones')::numeric, markup_refacciones),
    bono_hora          = coalesce((fin->>'bono_hora')::numeric, bono_hora),
    umbral_bono_horas  = coalesce((fin->>'umbral_bono_horas')::numeric, umbral_bono_horas)
  where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public._guardar_catalogo(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare x jsonb; n int := 0;
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia edita las horas por etapa'); end if;
  for x in select * from jsonb_array_elements(coalesce(p->'etapas', '[]')) loop
    update public.catalogo_etapa set
      h_leve = coalesce((x->>'h_leve')::numeric, h_leve),
      h_medio = coalesce((x->>'h_medio')::numeric, h_medio),
      h_fuerte = coalesce((x->>'h_fuerte')::numeric, h_fuerte),
      h_reemplazo = coalesce((x->>'h_reemplazo')::numeric, h_reemplazo),
      material_hora = coalesce((x->>'material_hora')::numeric, material_hora)
    where tipo = x->>'tipo';
    if not found then perform public._falla('Etapa de catálogo inexistente: ' || coalesce(x->>'tipo', '?')); end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('actualizadas', n);
end $$;

create or replace function public._guardar_area(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_a public.area; v_cap int; v_tipo text;
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia edita áreas'); end if;
  if coalesce(trim(p->>'nombre'), '') = '' then perform public._falla('Falta el nombre del área'); end if;
  if v_id is null then
    insert into public.area (nombre, tipo, capacidad, color, orden, activa)
    values (trim(p->>'nombre'), p->>'tipo', coalesce((p->>'capacidad')::int, 1), coalesce(p->>'color', '#64748b'),
            coalesce((p->>'orden')::int, 99), coalesce((p->>'activa')::boolean, true))
    returning * into v_a;
  else
    perform public._lock('area:' || v_id);
    select * into v_a from public.area where id = v_id for update;
    if v_a.id is null then perform public._falla('Área inexistente'); end if;
    v_cap := coalesce((p->>'capacidad')::int, v_a.capacidad);
    v_tipo := coalesce(p->>'tipo', v_a.tipo);
    if exists (select 1 from public.bloque where area_id = v_id and fin > now() and slot > v_cap) then
      perform public._falla('Hay bloques futuros que usan más capacidad que la nueva');
    end if;
    if v_tipo <> v_a.tipo and exists (select 1 from public.bloque where area_id = v_id and tipo = 'trabajo' and fin > now()) then
      perform public._falla('No se puede cambiar el tipo: el área tiene bloques futuros');
    end if;
    update public.area set nombre = trim(p->>'nombre'), tipo = v_tipo, capacidad = v_cap,
      color = coalesce(p->>'color', color), orden = coalesce((p->>'orden')::int, orden),
      activa = coalesce((p->>'activa')::boolean, activa)
    where id = v_id returning * into v_a;
  end if;
  return to_jsonb(v_a);
end $$;

create or replace function public._guardar_tecnico(p jsonb, p_uid uuid, p_rol text) returns jsonb
language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_t public.tecnico; v_esp text[]; v_h jsonb;
begin
  if p_rol <> 'gerencia' then perform public._falla('Solo gerencia edita técnicos'); end if;
  if coalesce(trim(p->>'nombre'), '') = '' then perform public._falla('Falta el nombre del técnico'); end if;
  v_esp := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'especialidades') x), '{}');
  v_h := p->'horario';
  if v_h is not null and (jsonb_typeof(v_h->'dias') <> 'array' or (v_h->>'inicio')::time >= (v_h->>'fin')::time) then
    perform public._falla('Horario inválido');
  end if;
  if v_id is null then
    insert into public.tecnico (nombre, especialidades, tarifa_hora, horario, activo)
    values (trim(p->>'nombre'), v_esp, coalesce((p->>'tarifa_hora')::numeric, 0),
            coalesce(v_h, '{"dias":[1,2,3,4,5,6],"inicio":"08:00","fin":"17:00"}'), coalesce((p->>'activo')::boolean, true))
    returning * into v_t;
  else
    update public.tecnico set nombre = trim(p->>'nombre'), especialidades = v_esp,
      tarifa_hora = coalesce((p->>'tarifa_hora')::numeric, tarifa_hora), horario = coalesce(v_h, horario),
      activo = coalesce((p->>'activo')::boolean, activo)
    where id = v_id returning * into v_t;
    if v_t.id is null then perform public._falla('Técnico inexistente'); end if;
  end if;
  return jsonb_build_object('id', v_t.id, 'nombre', v_t.nombre);
end $$;

-- ---------------------------------------------------------------------
-- Punto de entrada único de escritura: transaccional e idempotente
-- ---------------------------------------------------------------------
create or replace function public.operar(p_op_id uuid, p_tipo text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid(); v_rol text; v_res jsonb; v_prev public.operacion; v_n int;
begin
  if v_uid is null then raise exception 'Sesión requerida' using errcode = '28000'; end if;
  v_rol := public.mi_rol();
  if v_rol is null then raise exception 'Tu usuario no tiene perfil asignado' using errcode = '42501'; end if;
  if p_op_id is null then perform public._falla('Falta op_id'); end if;

  insert into public.operacion (op_id, tipo, user_id, payload) values (p_op_id, p_tipo, v_uid, p_payload)
  on conflict (op_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    select * into v_prev from public.operacion where op_id = p_op_id;
    if v_prev.user_id <> v_uid or v_prev.tipo <> p_tipo then
      perform public._falla('Ese op_id ya se usó para otra operación');
    end if;
    return coalesce(v_prev.resultado, '{}'::jsonb) || jsonb_build_object('repetida', true);
  end if;

  if    p_tipo = 'crear_orden'             then v_res := public._crear_orden(p_payload, v_uid, v_rol);
  elsif p_tipo = 'programar_bloque'        then v_res := public._programar_bloque(p_payload, v_uid, v_rol);
  elsif p_tipo = 'cancelar_bloque'         then v_res := public._cancelar_bloque(p_payload, v_uid, v_rol);
  elsif p_tipo = 'programar_mantenimiento' then v_res := public._programar_mantenimiento(p_payload, v_uid, v_rol);
  elsif p_tipo = 'etapa_accion'            then v_res := public._etapa_accion(p_payload, v_uid, v_rol);
  elsif p_tipo = 'registrar_pago'          then v_res := public._registrar_pago(p_payload, v_uid, v_rol, p_op_id);
  elsif p_tipo = 'autorizar_presupuesto'   then v_res := public._autorizar_presupuesto(p_payload, v_uid, v_rol);
  elsif p_tipo = 'alta_refaccion'          then v_res := public._alta_refaccion(p_payload, v_uid, v_rol);
  elsif p_tipo = 'recibir_refaccion'       then v_res := public._recibir_refaccion(p_payload, v_uid, v_rol);
  elsif p_tipo = 'cerrar_liquidacion'      then v_res := public._cerrar_liquidacion(p_payload, v_uid, v_rol, p_op_id);
  elsif p_tipo = 'guardar_config'          then v_res := public._guardar_config(p_payload, v_uid, v_rol);
  elsif p_tipo = 'guardar_catalogo'        then v_res := public._guardar_catalogo(p_payload, v_uid, v_rol);
  elsif p_tipo = 'guardar_area'            then v_res := public._guardar_area(p_payload, v_uid, v_rol);
  elsif p_tipo = 'guardar_tecnico'         then v_res := public._guardar_tecnico(p_payload, v_uid, v_rol);
  else perform public._falla('Operación desconocida: ' || coalesce(p_tipo, '?'));
  end if;

  update public.operacion set resultado = v_res where op_id = p_op_id;
  return v_res || jsonb_build_object('repetida', false);
end $$;

-- ---------------------------------------------------------------------
-- Lecturas protegidas (devuelven solo lo que el rol puede ver)
-- ---------------------------------------------------------------------
create or replace function public.orden_finanzas(p_orden uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rol text := public.mi_rol(); v_o public.orden; v_p public.presupuesto; v_pagado numeric; v_ded_pag numeric; c public.config;
begin
  if v_rol not in ('gerencia', 'asesor') then return null; end if;
  select * into v_o from public.orden where id = p_orden;
  if v_o.id is null then return null; end if;
  select * into v_p from public.presupuesto where orden_id = p_orden;
  select * into c from public.config where id = 1;
  v_pagado := public._pagado(p_orden);
  select coalesce(sum(monto), 0) into v_ded_pag from public.pago where orden_id = p_orden and concepto = 'Deducible';
  return jsonb_build_object(
    'orden_id', v_o.id, 'folio', v_o.folio, 'tipo', v_o.tipo, 'aseguradora', v_o.aseguradora, 'deducible', v_o.deducible,
    'tarifa_mo', c.tarifa_mo, 'iva_pct', c.iva, 'anticipo_pct', c.anticipo_pct,
    'presupuesto', to_jsonb(v_p),
    'pagado', v_pagado,
    'deducible_pagado', v_ded_pag,
    'saldo', v_p.total - v_pagado,
    'saldo_cliente', case when v_o.tipo = 'Aseguradora' then greatest(v_o.deducible - v_ded_pag, 0) else v_p.total - v_pagado end,
    'saldo_aseguradora', case when v_o.tipo = 'Aseguradora'
        then v_p.total - v_o.deducible - coalesce((select sum(monto) from public.pago where orden_id = p_orden and concepto = 'Aseguradora'), 0)
        else 0 end,
    'autorizada_para_programar', public._autorizada_para_programar(p_orden),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object(
        'tipo', e.tipo, 'nombre', ce.nombre, 'carga', e.carga, 'horas', e.horas,
        'mano_obra', round(e.horas * c.tarifa_mo, 2), 'materiales', round(e.horas * ce.material_hora, 2))
        order by e.secuencia, e.carga)
      from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo where e.orden_id = p_orden), '[]'),
    'refacciones', coalesce((select jsonb_agg(
        jsonb_build_object('id', r.id, 'nombre', r.nombre, 'precio_venta', r.precio_venta, 'estado', r.estado, 'recibida_en', r.recibida_en)
        || case when v_rol = 'gerencia' then jsonb_build_object('costo', r.costo) else '{}'::jsonb end
        order by r.creado_en)
      from public.refaccion r where r.orden_id = p_orden), '[]'),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'monto', g.monto, 'concepto', g.concepto,
        'metodo', g.metodo, 'creado_en', g.creado_en, 'op_id', g.op_id) order by g.creado_en)
      from public.pago g where g.orden_id = p_orden), '[]')
  );
end $$;

create or replace function public.refacciones_listado() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rol text := public.mi_rol();
begin
  if v_rol not in ('gerencia', 'asesor') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(
      jsonb_build_object('id', r.id, 'orden_id', r.orden_id, 'folio', o.folio, 'placa', o.placa, 'nombre', r.nombre,
                         'precio_venta', r.precio_venta, 'estado', r.estado, 'recibida_en', r.recibida_en, 'creado_en', r.creado_en)
      || case when v_rol = 'gerencia' then jsonb_build_object('costo', r.costo, 'margen', r.precio_venta - r.costo) else '{}'::jsonb end
      order by (r.estado = 'Recibida'), r.creado_en desc)
    from public.refaccion r join public.orden o on o.id = r.orden_id), '[]'::jsonb);
end $$;

create or replace function public.tecnicos_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'gerencia' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.nombre) from public.tecnico t), '[]'::jsonb);
end $$;

create or replace function public.liquidacion_semana(p_semana date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_l public.liquidacion; f public.config_finanzas;
begin
  if public.mi_rol() is distinct from 'gerencia' then return null; end if;
  select * into f from public.config_finanzas where id = 1;
  select * into v_l from public.liquidacion where semana_inicio = p_semana;
  if v_l.id is not null then
    return jsonb_build_object('semana_inicio', p_semana, 'estado', 'Cerrada', 'cerrada_en', v_l.cerrada_en,
      'bono_hora', f.bono_hora, 'umbral_bono_horas', f.umbral_bono_horas,
      'filas', coalesce((select jsonb_agg(to_jsonb(d) - 'liquidacion_id' order by d.tecnico_nombre)
                          from public.liquidacion_detalle d where d.liquidacion_id = v_l.id), '[]'));
  end if;
  return jsonb_build_object('semana_inicio', p_semana, 'estado', 'Abierta',
    'bono_hora', f.bono_hora, 'umbral_bono_horas', f.umbral_bono_horas,
    'filas', coalesce((select jsonb_agg(to_jsonb(l)) from public._liquidacion_calculo(p_semana) l), '[]'));
end $$;

create or replace function public.panel_gerencia(p_semana date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.config; lo timestamptz; hi timestamptz;
  v_hv numeric; v_costo numeric; v_mat numeric; v_ref numeric; v_cobrado numeric;
begin
  if public.mi_rol() is distinct from 'gerencia' then return null; end if;
  select * into c from public.config where id = 1;
  lo := p_semana::timestamp at time zone c.zona_horaria;
  hi := (p_semana + 7)::timestamp at time zone c.zona_horaria;
  select coalesce(sum(horas_vendidas), 0), coalesce(sum(total), 0) into v_hv, v_costo from public._liquidacion_calculo(p_semana);
  select coalesce(sum(e.horas * ce.material_hora), 0) into v_mat
    from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo
   where e.estado = 'Terminada' and e.terminada_en >= lo and e.terminada_en < hi;
  select coalesce(sum(precio_venta - costo), 0) into v_ref from public.refaccion where recibida_en >= lo and recibida_en < hi;
  select coalesce(sum(monto), 0) into v_cobrado from public.pago where creado_en >= lo and creado_en < hi;
  return jsonb_build_object(
    'semana_inicio', p_semana,
    'horas_vendidas', v_hv,
    'venta_mano_obra', round(v_hv * c.tarifa_mo, 2),
    'venta_materiales', round(v_mat, 2),
    'margen_refacciones', v_ref,
    'costo_tecnicos', v_costo,
    'ganancia', round(v_hv * c.tarifa_mo, 2) + v_ref - v_costo,
    'cobrado', v_cobrado,
    'horas_programadas', coalesce((select jsonb_agg(jsonb_build_object('area', a.nombre, 'color', a.color, 'horas', x.h) order by a.orden)
        from public.area a cross join lateral (
          select round(coalesce(sum(extract(epoch from (least(b.fin, hi) - greatest(b.inicio, lo))) / 3600), 0), 2) h
            from public.bloque b where b.area_id = a.id and b.tipo = 'trabajo' and b.inicio < hi and b.fin > lo) x), '[]'),
    'tecnicos', coalesce((select jsonb_agg(to_jsonb(l)) from public._liquidacion_calculo(p_semana) l), '[]'),
    'atrasos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'folio', v.folio, 'placa', v.placa, 'cliente', v.cliente,
        'fecha_prometida', v.fecha_prometida, 'fin_programado', v.fin_programado, 'etapa_actual', v.etapa_actual, 'estado', v.estado)
        order by v.fecha_prometida)
      from public.v_orden_lista v where v.atrasada), '[]')
  );
end $$;

-- Consulta pública: exige folio Y placa exactos; nunca devuelve otra orden.
create or replace function public.consulta_publica(p_folio text, p_placa text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record; v_pagado numeric; v_ded_pag numeric; v_total numeric;
begin
  select o.id, o.folio, o.placa, o.tipo, o.estado, o.fecha_prometida, o.deducible, vl.etapa_actual, vl.atrasada
    into v
    from public.orden o join public.v_orden_lista vl on vl.id = o.id
   where o.folio = upper(trim(coalesce(p_folio, '')))
     and regexp_replace(o.placa, '[^A-Z0-9]', '', 'g') = regexp_replace(upper(coalesce(p_placa, '')), '[^A-Z0-9]', '', 'g')
     and length(regexp_replace(upper(coalesce(p_placa, '')), '[^A-Z0-9]', '', 'g')) >= 3;
  if v.id is null then return null; end if;
  select total into v_total from public.presupuesto where orden_id = v.id;
  v_pagado := public._pagado(v.id);
  select coalesce(sum(monto), 0) into v_ded_pag from public.pago where orden_id = v.id and concepto = 'Deducible';
  return jsonb_build_object(
    'folio', v.folio, 'placa', v.placa, 'estado', v.estado,
    'etapa_actual', coalesce(v.etapa_actual, case when v.estado in ('Terminada','Entregada') then 'Lista para entrega' end),
    'fecha_prometida', v.fecha_prometida, 'atrasada', v.atrasada,
    'saldo', case when v.tipo = 'Aseguradora' then greatest(v.deducible - v_ded_pag, 0) else v_total - v_pagado end);
end $$;

-- ---------------------------------------------------------------------
-- Vistas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------
create or replace view public.v_orden_lista with (security_invoker = true) as
select o.id, o.folio, o.placa, o.tipo, o.aseguradora, o.estado, o.fecha_prometida, o.creado_en, o.cliente_id,
       c.nombre as cliente, c.telefono as cliente_telefono,
       fp.fin_programado, ea.etapa_actual,
       (o.estado not in ('Entregada', 'Cancelada') and (
          (fp.fin_programado is not null and fp.fin_programado > o.fecha_prometida)
          or (o.estado <> 'Terminada' and now() > o.fecha_prometida))) as atrasada
  from public.orden o
  left join public.cliente c on c.id = o.cliente_id
  left join lateral (select max(b.fin) as fin_programado
                       from public.etapa e join public.bloque b on b.etapa_id = e.id
                      where e.orden_id = o.id) fp on true
  left join lateral (select ce.nombre || case when e.tipo = 'pintura' and e.carga > 1 then ' (carga ' || e.carga || ')' else '' end as etapa_actual
                       from public.etapa e join public.catalogo_etapa ce on ce.tipo = e.tipo
                      where e.orden_id = o.id and e.estado <> 'Terminada'
                      order by e.secuencia, e.carga limit 1) ea on true;

create or replace view public.v_planificador with (security_invoker = true) as
select b.id, b.folio, b.tipo, b.inicio, b.fin, b.fin_tecnico, b.margen, b.slot, b.area_id, b.tecnico_id, b.nota,
       t.nombre as tecnico, e.id as etapa_id, e.tipo as etapa_tipo, ce.nombre as etapa_nombre, e.estado as etapa_estado,
       e.carga, e.piezas, e.horas, o.id as orden_id, o.folio as orden_folio, o.placa, o.fecha_prometida,
       coalesce(vo.atrasada, false) as atrasada
  from public.bloque b
  left join public.tecnico t on t.id = b.tecnico_id
  left join public.etapa e on e.id = b.etapa_id
  left join public.catalogo_etapa ce on ce.tipo = e.tipo
  left join public.orden o on o.id = e.orden_id
  left join public.v_orden_lista vo on vo.id = o.id;
