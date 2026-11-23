import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { operar, OpError, nuevoOpId } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { aMin, deMin, desdeZona, enZona, etiquetaDia, fechaHora, hora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Atrasada, Aviso, Boton, Campo, Cargando, Encabezado, Estado, Modal } from '@/components/ui';

const W = 24;       // px por bloque de 30 min
const ALTO = 44;    // px por lugar del área
const CAP = 16;     // px de la tira de capacidad

type Bloque = {
  id: string; folio: string; tipo: 'trabajo' | 'mantenimiento'; inicio: string; fin: string; fin_tecnico: string | null;
  margen: number; slot: number; area_id: string; tecnico_id: string | null; nota: string | null; tecnico: string | null;
  tramo: number; tramos: number;
  etapa_id: string | null; etapa_tipo: string | null; etapa_nombre: string | null; etapa_estado: string | null;
  carga: number | null; piezas: number | null; horas: number | null; orden_id: string | null; orden_folio: string | null;
  placa: string | null; fecha_prometida: string | null; atrasada: boolean;
};
type Area = { id: string; nombre: string; tipo: string; capacidad: number; color: string; orden: number };
type Franja = { dia: number; inicio: string; fin: string };
type Conflicto = { mensaje: string; folio?: string };
type Inicial = { orden_id?: string; etapa_id?: string; area_id?: string; dia?: string; hora?: string };

const NOMBRES: Record<string, string> = {
  desarmado: 'Desarmado', enderezado: 'Enderezado', preparacion: 'Preparación', pintura: 'Pintura',
  pulido_armado: 'Pulido y armado', control_calidad: 'Control de calidad',
};
export const nombreEtapa = (t: string) => NOMBRES[t] ?? t;
const isoDow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay() || 7;

export default function Planificador() {
  const [lunes, setLunes] = useState(lunesDe());
  const [modal, setModal] = useState<Inicial | null>(null);
  const [detalle, setDetalle] = useState<Bloque | null>(null);
  const [resaltado, setResaltado] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const base = useCarga(async () => {
    const [config, areas, tecnicos, franjas] = await Promise.all([
      q(supabase.from('config').select('margen_default_min, horneado_horas, curado_horas, cabina_max_piezas').eq('id', 1).single()),
      q<Area[]>(supabase.from('area').select('id, nombre, tipo, capacidad, color, orden').eq('activa', true).order('orden')),
      q(supabase.from('tecnico').select('id, nombre, especialidades, dias_laborables, activo').eq('activo', true).order('nombre')),
      q<Franja[]>(supabase.from('horario_taller').select('dia, inicio, fin').order('dia').order('inicio')),
    ]);
    return { config, areas, tecnicos, franjas };
  }, []);

  const semana = useCarga(async () => {
    const lo = desdeZona(lunes, '00:00').toISOString();
    const hi = desdeZona(sumarDias(lunes, 7), '00:00').toISOString();
    const [bloques, ordenes] = await Promise.all([
      q<Bloque[]>(supabase.from('v_planificador').select('*').lt('inicio', hi).gt('fin', lo).order('inicio')),
      q<any[]>(supabase.from('v_orden_lista').select('id, folio, placa, cliente, tipo, estado, atrasada, fecha_prometida')
        .eq('habilitada', true).order('fecha_prometida')),
    ]);
    const ids = ordenes.map((o) => o.id);
    const etapas = ids.length ? await q<any[]>(supabase.from('etapa').select('id, orden_id, tipo, secuencia, carga, area_tipo, especialidades, programable, horas, piezas, estado').in('orden_id', ids).order('secuencia').order('carga')) : [];
    return { bloques, ordenes, etapas };
  }, [lunes]);

  const actualizar = () => { setConflicto(null); setResaltado(null); semana.recargar(); };

  if (base.cargando && !base.data) return <Cargando />;
  if (base.error) return <Aviso tipo="error">{base.error}</Aviso>;
  const { config, areas, tecnicos, franjas } = base.data!;
  const bloques = semana.data?.bloques ?? [];
  const diasHab = [...new Set(franjas.map((f) => f.dia))].sort((a, b) => a - b);
  const dias = diasHab.map((d) => sumarDias(lunes, d - 1));
  const desde = Math.min(...franjas.map((f) => aMin(f.inicio.slice(0, 5))));
  const hasta = Math.max(...franjas.map((f) => aMin(f.fin.slice(0, 5))));
  const slotsDia = (hasta - desde) / 30;
  const franjasDe = (fecha: string) => franjas.filter((f) => f.dia === isoDow(fecha)).map((f) => [aMin(f.inicio.slice(0, 5)), aMin(f.fin.slice(0, 5))]);
  const atrasadas = [...new Set(bloques.filter((b) => b.atrasada).map((b) => b.orden_folio))];

  // Etapas listas para arrastrar: la próxima pendiente de cada orden habilitada
  const porProgramar = (semana.data?.ordenes ?? []).flatMap((o) => {
    const et = (semana.data?.etapas ?? []).filter((e) => e.orden_id === o.id && e.programable);
    const prox = et.find((e) => e.estado === 'Pendiente');
    if (!prox) return [];
    const previasOk = et.filter((e) => e.secuencia < prox.secuencia).every((e) => e.estado !== 'Pendiente');
    return previasOk ? [{ ...prox, orden: o }] : [];
  });

  const mover = async (b: Bloque, area_id: string, dia: string, min: number) => {
    setConflicto(null); setAviso(null);
    try {
      const r = await operar<any>('programar_bloque', {
        etapa_id: b.etapa_id, tecnico_id: b.tecnico_id, area_id, inicio: desdeZona(dia, deMin(min)).toISOString(),
        margen: b.margen, reprogramar: true,
      }, nuevoOpId());
      setAviso({ tipo: 'ok', texto: `${b.orden_folio} · ${b.etapa_nombre} movida: ${r.folios.join(', ')}` });
      semana.recargar();
    } catch (e) {
      const err = e as OpError;
      if (err.conflicto) { setConflicto({ mensaje: err.message, folio: err.detalle?.folio }); setResaltado(err.detalle?.folio ?? null); }
      else setAviso({ tipo: 'error', texto: err.message });
    }
  };

  return (
    <div>
      <Encabezado titulo="Planificador semanal" sub={`Semana del ${etiquetaDia(lunes)} · bloques de 30 min · arrastrá una etapa o una ficha al hueco`}>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, -7))} aria-label="Semana anterior">◀</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(lunesDe())}>Hoy</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente">▶</Boton>
        <Boton onClick={actualizar} cargando={semana.cargando}>Actualizar</Boton>
        <Boton variante="primario" onClick={() => setModal({})}>+ Programar bloque</Boton>
      </Encabezado>

      <div className="mb-3 space-y-2">
        {conflicto && <Aviso tipo="conflicto" accion={<Boton variante="alerta" onClick={actualizar}>Actualizar</Boton>}>{conflicto.mensaje} No se movió nada.</Aviso>}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        {atrasadas.length > 0 && <Aviso tipo="atraso">{atrasadas.join(', ')}: la última etapa programada supera la fecha prometida.</Aviso>}
        {semana.error && <Aviso tipo="error">{semana.error}</Aviso>}
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <PorProgramar items={porProgramar} onClick={(e) => setModal({ orden_id: e.orden_id, etapa_id: e.id })} />
        <div className="min-w-0 flex-1">
          <Grilla areas={areas} dias={dias} desde={desde} slotsDia={slotsDia} franjasDe={franjasDe} bloques={bloques} resaltado={resaltado}
            onVacio={(area_id, dia, min) => setModal({ area_id, dia, hora: deMin(min) })} onBloque={setDetalle}
            onSoltarEtapa={(etapa, area_id, dia, min) => setModal({ orden_id: etapa.orden_id, etapa_id: etapa.id, area_id, dia, hora: deMin(min) })}
            onSoltarBloque={mover} porProgramar={porProgramar} />
          <Leyenda areas={areas} />
        </div>
      </div>

      {modal && (
        <ProgramarModal inicial={modal} dias={dias} franjasDe={franjasDe} config={config} areas={areas} tecnicos={tecnicos}
          ordenes={semana.data?.ordenes ?? []}
          onCerrar={() => { setModal(null); setResaltado(null); }}
          onConflicto={(folio) => { setResaltado(folio ?? null); semana.recargar(); }}
          onActualizar={() => semana.recargar()}
          onListo={() => { setModal(null); setResaltado(null); semana.recargar(); }} />
      )}
      {detalle && <DetalleBloque b={detalle} onCerrar={() => setDetalle(null)} onCambio={() => { setDetalle(null); semana.recargar(); }} />}
    </div>
  );
}

function PorProgramar({ items, onClick }: { items: any[]; onClick: (e: any) => void }) {
  return (
    <aside className="tarjeta shrink-0 xl:w-60">
      <h2 className="etiqueta border-b border-grafito-200 px-3 py-2.5 text-sm">Por programar ({items.length})</h2>
      <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto p-2 xl:max-h-[38rem]">
        {items.length === 0 && <li className="p-2 text-sm text-grafito-500">Nada pendiente en órdenes habilitadas.</li>}
        {items.map((e) => (
          <li key={e.id} draggable onDragStart={(ev) => { ev.dataTransfer.setData('application/x-etapa', e.id); ev.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => onClick(e)}
            className={`cursor-grab rounded-md border bg-grafito-50 px-2.5 py-2 text-sm hover:border-grafito-500 active:cursor-grabbing ${e.orden.atrasada ? 'border-alerta' : 'border-grafito-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="folio">{e.orden.folio}</span>
              <span className="font-mono text-xs text-grafito-500">{e.orden.placa}</span>
            </div>
            <div className="font-cond font-semibold uppercase tracking-wide">{nombreEtapa(e.tipo)}{e.tipo === 'pintura' ? ` c${e.carga}` : ''}</div>
            <div className="text-xs text-grafito-500">{horas(e.horas)}{e.tipo === 'pintura' ? ` + horneado · ${e.piezas} pzas` : ''} · {e.especialidades.join(' o ')}</div>
            {e.orden.atrasada && <div className="mt-1"><Atrasada /></div>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Grilla({ areas, dias, desde, slotsDia, franjasDe, bloques, resaltado, onVacio, onBloque, onSoltarEtapa, onSoltarBloque, porProgramar }: {
  areas: Area[]; dias: string[]; desde: number; slotsDia: number; franjasDe: (f: string) => number[][]; bloques: Bloque[];
  resaltado: string | null; onVacio: (area: string, dia: string, min: number) => void; onBloque: (b: Bloque) => void;
  onSoltarEtapa: (etapa: any, area: string, dia: string, min: number) => void;
  onSoltarBloque: (b: Bloque, area: string, dia: string, min: number) => void; porProgramar: any[];
}) {
  const ancho = dias.length * slotsDia * W;
  const scroller = useRef<HTMLDivElement>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const ahora = enZona(new Date());
  const idxHoy = dias.indexOf(ahora.fecha);
  const xAhora = idxHoy >= 0 && ahora.min >= desde && ahora.min <= desde + slotsDia * 30 ? idxHoy * slotsDia * W + ((ahora.min - desde) / 30) * W : null;
  useEffect(() => { if (scroller.current && idxHoy > 0) scroller.current.scrollLeft = idxHoy * slotsDia * W - 40; }, [idxHoy]);

  const pos = (iso: string) => {
    const z = enZona(new Date(iso));
    const d = dias.indexOf(z.fecha);
    return d < 0 ? null : d * slotsDia * W + ((z.min - desde) / 30) * W;
  };
  const anchoDe = (a: string, b: string) => ((new Date(b).getTime() - new Date(a).getTime()) / 1800000) * W;
  const celda = (x: number) => {
    const idx = Math.max(0, Math.floor(x / W));
    const d = Math.min(dias.length - 1, Math.floor(idx / slotsDia));
    return { dia: dias[d], min: desde + (idx % slotsDia) * 30 };
  };

  // Cerrado: tramos del día fuera del horario del taller
  const cerrados = dias.flatMap((d, i) => {
    const fr = franjasDe(d).sort((a, b) => a[0] - b[0]);
    const huecos: number[][] = []; let cur = desde;
    for (const [a, b] of fr) { if (a > cur) huecos.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < desde + slotsDia * 30) huecos.push([cur, desde + slotsDia * 30]);
    return huecos.map(([a, b]) => ({ x: i * slotsDia * W + ((a - desde) / 30) * W, w: ((b - a) / 30) * W }));
  });

  // Lugares libres por área y bloque de 30 min (incluye márgenes y mantenimiento)
  const libresPorArea = useMemo(() => Object.fromEntries(areas.map((area) => {
    const res: number[] = [];
    dias.forEach((d) => {
      for (let s = 0; s < slotsDia; s++) {
        const ini = desdeZona(d, deMin(desde + s * 30)).getTime(); const fin = ini + 1800000;
        const ocup = new Set(bloques.filter((b) => b.area_id === area.id && new Date(b.inicio).getTime() < fin
          && new Date(b.fin).getTime() + b.margen * 60000 > ini).map((b) => b.slot)).size;
        res.push(area.capacidad - ocup);
      }
    });
    return [area.id, res];
  })), [areas, bloques, dias.join(), desde, slotsDia]);

  const fondo = {
    width: ancho,
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${W - 1}px, rgba(31,41,51,.05) ${W - 1}px ${W}px),
      repeating-linear-gradient(90deg, transparent 0 ${2 * W - 1}px, rgba(31,41,51,.10) ${2 * W - 1}px ${2 * W}px)`,
  };

  const soltar = (ev: DragEvent<HTMLDivElement>, area: Area) => {
    ev.preventDefault(); setSobre(null);
    const rect = ev.currentTarget.getBoundingClientRect();
    const { dia, min } = celda(ev.clientX - rect.left);
    const etapaId = ev.dataTransfer.getData('application/x-etapa');
    const bloqueId = ev.dataTransfer.getData('application/x-bloque');
    if (etapaId) { const e = porProgramar.find((x) => x.id === etapaId); if (e) onSoltarEtapa(e, area.id, dia, min); }
    if (bloqueId) {
      const b = bloques.find((x) => x.id === bloqueId);
      if (b) { const primero = bloques.find((x) => x.etapa_id === b.etapa_id && x.tramo === 1) ?? b; onSoltarBloque(primero, area.id, dia, min); }
    }
  };

  return (
    <div className="tarjeta flex overflow-hidden">
      <div className="w-40 shrink-0 border-r border-grafito-200 bg-grafito-50 sm:w-52">
        <div className="h-12 border-b border-grafito-200 px-3 pt-2 font-cond text-xs font-semibold uppercase tracking-wider text-grafito-500">Área · lugares</div>
        {areas.map((area) => (
          <div key={area.id} className="border-b border-grafito-200">
            <div style={{ height: CAP }} className="flex items-center gap-1.5 px-3 font-cond text-[0.65rem] uppercase tracking-wider text-grafito-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: area.color }} />libres
            </div>
            {Array.from({ length: area.capacidad }, (_, i) => (
              <div key={i} style={{ height: ALTO }} className="flex items-center gap-2 border-t border-grafito-100 px-3">
                <span className="h-full w-1 shrink-0 rounded-full" style={{ background: area.color }} />
                <span className="truncate font-cond text-[0.8rem] font-semibold uppercase leading-tight tracking-wide text-grafito-800" title={area.nombre}>{area.nombre}</span>
                {area.capacidad > 1 && <span className="font-mono text-[0.65rem] text-grafito-400">#{i + 1}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
        <div style={{ width: ancho }} className="relative">
          <div className="sticky top-0 z-10 h-12 border-b border-grafito-200 bg-white">
            {dias.map((d, i) => (
              <div key={d} className="absolute top-0 h-12 border-l border-grafito-400" style={{ left: i * slotsDia * W, width: slotsDia * W }}>
                <div className={`px-2 pt-1 font-cond text-xs font-bold uppercase tracking-wider ${d === ahora.fecha ? 'text-grafito-900' : 'text-grafito-500'}`}>{etiquetaDia(d)}{d === ahora.fecha ? ' · hoy' : ''}</div>
                {Array.from({ length: Math.ceil(slotsDia / 2) }, (_, h) => (
                  <div key={h} className="absolute bottom-1 font-mono text-[0.62rem] text-grafito-400" style={{ left: h * 2 * W + 2 }}>{deMin(desde + h * 60).slice(0, 2)}</div>
                ))}
              </div>
            ))}
          </div>
          {areas.map((area) => (
            <div key={area.id} className="border-b border-grafito-200">
              {/* Tira de capacidad: lugares libres en cada bloque de 30 min */}
              <div className="relative flex" style={{ height: CAP }}>
                {libresPorArea[area.id]?.map((n: number, i: number) => (
                  <div key={i} style={{ width: W }} title={n <= 0 ? 'Lleno' : `${n} libre(s)`}
                    className={`flex shrink-0 items-center justify-center border-r border-white font-mono text-[0.6rem] ${n <= 0 ? 'bg-grafito-900 text-white' : n < area.capacidad ? 'bg-grafito-200 text-grafito-700' : 'text-grafito-300'}`}>
                    {n <= 0 ? '■' : n}
                  </div>
                ))}
                {cerrados.map((c, i) => <div key={i} className="cerrado pointer-events-none absolute inset-y-0" style={{ left: c.x, width: c.w }} />)}
              </div>
              {Array.from({ length: area.capacidad }, (_, i) => i + 1).map((slot) => (
                <div key={slot} style={{ ...fondo, height: ALTO }}
                  className={`relative cursor-crosshair border-t border-grafito-100 ${sobre === area.id + slot ? 'bg-grafito-100' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setSobre(area.id + slot); }}
                  onDragLeave={() => setSobre(null)}
                  onDrop={(e) => soltar(e, area)}
                  onClick={(e) => { if (e.target !== e.currentTarget) return; const { dia, min } = celda(e.nativeEvent.offsetX); onVacio(area.id, dia, min); }}>
                  {cerrados.map((c, k) => <div key={k} className="cerrado pointer-events-none absolute inset-y-0" style={{ left: c.x, width: c.w }} title="Taller cerrado" />)}
                  {dias.map((d, k) => k > 0 && <div key={d} className="pointer-events-none absolute inset-y-0 border-l border-grafito-400" style={{ left: k * slotsDia * W }} />)}
                  {bloques.filter((b) => b.area_id === area.id && b.slot === slot).map((b) => (
                    <Ficha key={b.id} b={b} area={area} x={pos(b.inicio)} w={anchoDe(b.inicio, b.fin)}
                      wTec={b.fin_tecnico ? anchoDe(b.inicio, b.fin_tecnico) : anchoDe(b.inicio, b.fin)} resaltado={resaltado === b.folio} onClick={() => onBloque(b)} />
                  ))}
                  {bloques.filter((b) => b.area_id === area.id && b.slot === slot && b.margen > 0).map((b) => {
                    const x = pos(b.fin);
                    return x == null ? null : <div key={b.id + 'm'} className="rayas-suaves pointer-events-none absolute top-2 bottom-2 rounded-r border border-dashed border-grafito-400" style={{ left: x, width: (b.margen / 30) * W }} title={`Margen ${b.margen} min`} />;
                  })}
                  {xAhora != null && <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-grafito-900" style={{ left: xAhora }} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Ficha({ b, area, x, w, wTec, resaltado, onClick }: { b: Bloque; area: Area; x: number | null; w: number; wTec: number; resaltado: boolean; onClick: () => void }) {
  if (x == null) return null;
  const mant = b.tipo === 'mantenimiento';
  const terminado = b.etapa_estado === 'Terminada';
  const movible = !mant && b.etapa_estado === 'Programada';
  return (
    <button draggable={movible} onDragStart={(ev) => { ev.dataTransfer.setData('application/x-bloque', b.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onClick={onClick}
      title={`${b.folio} · ${b.orden_folio ?? 'Mantenimiento'} · ${b.etapa_nombre ?? b.nota ?? ''} · ${hora(b.inicio)}–${hora(b.fin)}${b.tramos > 1 ? ` · tramo ${b.tramo}/${b.tramos}` : ''}`}
      className={`absolute top-1 bottom-1 z-[5] overflow-hidden rounded text-left text-white shadow-sm transition hover:z-10 hover:brightness-110
        ${movible ? 'cursor-grab active:cursor-grabbing' : ''}
        ${b.atrasada ? 'ring-2 ring-alerta ring-offset-1' : ''} ${resaltado ? 'z-20 animate-pulse ring-4 ring-alerta' : ''} ${terminado ? 'opacity-45' : ''}
        ${b.etapa_estado === 'Pausada' ? 'outline-dashed outline-2 outline-grafito-900' : ''}`}
      style={{ left: x + 1, width: Math.max(w - 2, 8), background: mant ? '#36404B' : area.color }}>
      {mant && <span className="rayas absolute inset-0" />}
      {!mant && w > wTec && <span className="rayas absolute inset-y-0 right-0 bg-black/15" style={{ width: w - wTec }} title="Horneado: cabina ocupada, técnico libre" />}
      <span className="relative block truncate px-1.5 pt-0.5 text-[0.72rem] font-bold leading-tight">
        {b.etapa_estado === 'En curso' && '● '}{mant ? 'MANTENIMIENTO' : b.orden_folio}{b.tramos > 1 ? ` ${b.tramo}/${b.tramos}` : ''}{terminado && ' ✓'}
      </span>
      <span className="relative block truncate px-1.5 font-cond text-[0.68rem] uppercase leading-tight tracking-wide">
        {mant ? b.nota ?? '' : `${b.etapa_nombre}${b.etapa_tipo === 'pintura' ? ` c${b.carga}` : ''} · ${b.tecnico?.replace('Técnico ', 'T.')}`}
      </span>
      {b.atrasada && w >= 90 && <span className="absolute right-0 top-0 rounded-bl bg-alerta px-1 font-cond text-[0.55rem] font-bold uppercase">Atraso</span>}
    </button>
  );
}

function Leyenda({ areas }: { areas: Area[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-grafito-500">
      {areas.map((a) => <span key={a.id} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: a.color }} />{a.nombre}</span>)}
      <span className="flex items-center gap-1.5"><span className="rayas h-3 w-5 rounded-sm bg-grafito-700" />Horneado / mantenimiento</span>
      <span className="flex items-center gap-1.5"><span className="rayas-suaves h-3 w-5 rounded-sm border border-dashed border-grafito-400" />Margen</span>
      <span className="flex items-center gap-1.5"><span className="cerrado h-3 w-5 rounded-sm" />Taller cerrado</span>
      <span className="flex items-center gap-1.5"><span className="flex h-3 w-4 items-center justify-center bg-grafito-900 text-[0.5rem] text-white">■</span>Área llena</span>
      <span>● En curso · ✓ Terminada · 1/2 = tramo</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm ring-2 ring-alerta" />Atraso / conflicto</span>
    </div>
  );
}

function ProgramarModal({ inicial, dias, franjasDe, config, areas, tecnicos, ordenes, onCerrar, onConflicto, onActualizar, onListo }: {
  inicial: Inicial; dias: string[]; franjasDe: (f: string) => number[][]; config: any; areas: Area[]; tecnicos: any[]; ordenes: any[];
  onCerrar: () => void; onConflicto: (folio?: string) => void; onActualizar: () => void; onListo: () => void;
}) {
  const [ordenId, setOrdenId] = useState(inicial.orden_id ?? '');
  const [etapaId, setEtapaId] = useState(inicial.etapa_id ?? '');
  const [tecnicoId, setTecnicoId] = useState('');
  const [areaId, setAreaId] = useState(inicial.area_id ?? '');
  const [dia, setDia] = useState(inicial.dia ?? dias[0]);
  const [hhmm, setHhmm] = useState(inicial.hora ?? '');
  const [margen, setMargen] = useState<number>(config.margen_default_min ?? 0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);

  const etapas = useCarga(async () => ordenId
    ? q<any[]>(supabase.from('etapa').select('id, tipo, secuencia, carga, area_tipo, especialidades, programable, horas, piezas, estado').eq('orden_id', ordenId).order('secuencia').order('carga'))
    : [], [ordenId]);
  const etapa = (etapas.data ?? []).find((e: any) => e.id === etapaId);
  const tecs = tecnicos.filter((t) => !etapa || t.especialidades.some((s: string) => etapa.especialidades.includes(s)));
  const areasOk = areas.filter((a) => !etapa || a.tipo === etapa.area_tipo);

  useEffect(() => {
    if (!etapas.data) return;
    if (inicial.etapa_id && etapas.data.some((e: any) => e.id === inicial.etapa_id) && etapaId) return;
    const prox = (etapas.data ?? []).find((e: any) => e.estado === 'Pendiente' && e.programable);
    setEtapaId(prox?.id ?? '');
  }, [etapas.data]);
  useEffect(() => {
    if (etapa && !areasOk.some((a) => a.id === areaId)) setAreaId(areasOk[0]?.id ?? '');
    if (etapa && !tecs.some((t) => t.id === tecnicoId)) setTecnicoId(tecs[0]?.id ?? '');
  }, [etapaId, etapa?.id]);

  const horasDia = useMemo(() => franjasDe(dia).flatMap(([a, b]) => Array.from({ length: (b - a) / 30 }, (_, i) => deMin(a + i * 30))), [dia]);
  useEffect(() => { if (!horasDia.includes(hhmm)) setHhmm(horasDia[0] ?? ''); }, [horasDia.join()]);

  const enviar = async () => {
    setEnviando(true); setError(null); setConflicto(null);
    try {
      await operar('programar_bloque', { etapa_id: etapaId, tecnico_id: tecnicoId, area_id: areaId, inicio: desdeZona(dia, hhmm).toISOString(), margen }, nuevoOpId());
      onListo();
    } catch (e) {
      const err = e as OpError;
      if (err.conflicto) { setConflicto({ mensaje: err.message, folio: err.detalle?.folio }); onConflicto(err.detalle?.folio); }
      else setError(err.message);
    } finally { setEnviando(false); }
  };

  const durMin = etapa ? Math.ceil(etapa.horas * 2) * 30 : 0;
  return (
    <Modal abierto titulo="Programar bloque" onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4">
        {conflicto && (
          <Aviso tipo="conflicto" accion={<Boton variante="alerta" onClick={() => { onActualizar(); setConflicto(null); }}>Actualizar</Boton>}>
            {conflicto.mensaje} No se ocupó ningún recurso.
          </Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Orden" ayuda="Solo órdenes habilitadas (anticipo o autorización).">
            <select className="campo" value={ordenId} onChange={(e) => setOrdenId(e.target.value)}>
              <option value="">Elegí una orden…</option>
              {ordenes.map((o: any) => <option key={o.id} value={o.id}>{o.folio} · {o.placa} · {o.cliente}{o.atrasada ? ' · ATRASADA' : ''}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Etapa">
            <select className="campo" value={etapaId} onChange={(e) => setEtapaId(e.target.value)} disabled={!ordenId}>
              <option value="">{ordenId ? 'Elegí la etapa…' : '—'}</option>
              {(etapas.data ?? []).filter((e: any) => e.programable).map((e: any) => (
                <option key={e.id} value={e.id} disabled={e.estado !== 'Pendiente'}>
                  {e.secuencia}. {nombreEtapa(e.tipo)}{e.tipo === 'pintura' ? ` carga ${e.carga} (${e.piezas} pzas)` : ''} · {horas(e.horas)} · {e.estado}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Técnico" ayuda={etapa ? `Especialidad: ${etapa.especialidades.join(' o ')}` : undefined}>
            <select className="campo" value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
              <option value="">Elegí técnico…</option>
              {tecs.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.dias_laborables.includes(6) ? '' : ' · no sábados'}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Área">
            <select className="campo" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Elegí área…</option>
              {areasOk.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.capacidad > 1 ? ` (${a.capacidad} lugares)` : ''}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Día">
              <select className="campo" value={dia} onChange={(e) => setDia(e.target.value)}>
                {dias.map((d) => <option key={d} value={d}>{etiquetaDia(d)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Inicio">
              <select className="campo" value={hhmm} onChange={(e) => setHhmm(e.target.value)}>
                {horasDia.map((h) => <option key={h}>{h}</option>)}
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Margen (min)" ayuda="Holgura tras el fin: limpieza, traslado.">
            <input className="campo" type="number" min={0} max={240} step={15} value={margen} onChange={(e) => setMargen(Number(e.target.value))} />
          </Campo>
        </div>
        {etapa && (
          <div className="rounded-md border border-grafito-200 bg-grafito-50 px-4 py-3 text-sm text-grafito-700">
            Técnico {durMin / 60} h desde las {hhmm}{etapa.tipo === 'pintura' && <> · después {config.horneado_horas} h de horneado con la cabina ocupada y el técnico libre</>}
            {margen > 0 && <> · +{margen} min de margen</>}.
            <span className="block text-xs text-grafito-500">Si no entra en la franja, sigue en la siguiente franja hábil con el mismo técnico y en la misma área. {etapa.tipo === 'pulido_armado' && `Exige ${config.curado_horas} h calendario de curado tras el horneado.`}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={enviar} cargando={enviando} disabled={!etapaId || !tecnicoId || !areaId || !hhmm}>Programar bloque</Boton>
        </div>
      </div>
    </Modal>
  );
}

function DetalleBloque({ b, onCerrar, onCambio }: { b: Bloque; onCerrar: () => void; onCambio: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quitar = async () => {
    if (!confirm(b.tipo === 'mantenimiento' ? `¿Quitar el mantenimiento ${b.folio}?` : '¿Quitar la etapa (todos sus tramos)?')) return;
    setEnviando(true); setError(null);
    try { await operar('cancelar_bloque', { bloque_id: b.id }); onCambio(); }
    catch (e: any) { setError(e.message); }
    finally { setEnviando(false); }
  };
  return (
    <Modal abierto titulo={`Bloque ${b.folio}`} onCerrar={onCerrar}>
      <div className="space-y-3 text-sm">
        {error && <Aviso tipo="error">{error}</Aviso>}
        {b.tipo === 'mantenimiento' ? <p>Mantenimiento{b.nota ? `: ${b.nota}` : ''}</p> : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="folio text-base">{b.orden_folio}</span><span className="font-mono text-grafito-600">{b.placa}</span>
            {b.etapa_estado && <Estado valor={b.etapa_estado} />}{b.atrasada && <Atrasada />}
          </div>
        )}
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          {b.etapa_nombre && <><dt className="text-grafito-500">Etapa</dt><dd>{b.etapa_nombre}{b.etapa_tipo === 'pintura' ? ` · carga ${b.carga} (${b.piezas} piezas)` : ''} · {horas(b.horas)}</dd></>}
          {b.tramos > 1 && <><dt className="text-grafito-500">Tramo</dt><dd>{b.tramo} de {b.tramos}</dd></>}
          {b.tecnico && <><dt className="text-grafito-500">Técnico</dt><dd>{b.tecnico}{b.fin_tecnico && b.fin_tecnico !== b.fin ? ` (libre desde ${hora(b.fin_tecnico)})` : ''}</dd></>}
          <dt className="text-grafito-500">Horario</dt><dd>{fechaHora(b.inicio)} → {hora(b.fin)}{b.margen ? ` +${b.margen} min margen` : ''}</dd>
          {b.fecha_prometida && <><dt className="text-grafito-500">Prometida</dt><dd className={b.atrasada ? 'font-semibold text-alerta-claro' : ''}>{fechaHora(b.fecha_prometida)}</dd></>}
        </dl>
        {b.etapa_estado === 'Programada' && <p className="text-xs text-grafito-500">Para moverla, arrastrá la ficha a otro hueco: la base valida todo de nuevo y, si no entra, no cambia nada.</p>}
        <div className="flex justify-end gap-2 pt-2">
          {b.orden_id && <Link to={`/ordenes/${b.orden_id}`} className="rounded-md px-3 py-2 font-cond text-sm font-semibold uppercase tracking-wide text-grafito-600 hover:bg-grafito-100">Ver orden</Link>}
          <Boton onClick={quitar} cargando={enviando} disabled={b.tipo === 'trabajo' && b.etapa_estado !== 'Programada'}>Quitar</Boton>
        </div>
      </div>
    </Modal>
  );
}
