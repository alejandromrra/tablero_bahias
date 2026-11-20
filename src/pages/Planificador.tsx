import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { operar, OpError, nuevoOpId } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { aMin, deMin, desdeZona, enZona, etiquetaDia, fechaHora, hora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Atrasada, Aviso, Boton, Campo, Cargando, Encabezado, Estado, Modal } from '@/components/ui';

const W = 26;       // px por bloque de 30 min
const ALTO = 46;    // px por fila (área / slot)

type Bloque = {
  id: string; folio: string; tipo: 'trabajo' | 'mantenimiento'; inicio: string; fin: string; fin_tecnico: string | null;
  margen: number; slot: number; area_id: string; tecnico_id: string | null; nota: string | null; tecnico: string | null;
  etapa_id: string | null; etapa_tipo: string | null; etapa_nombre: string | null; etapa_estado: string | null;
  carga: number | null; piezas: number | null; horas: number | null; orden_id: string | null; orden_folio: string | null;
  placa: string | null; fecha_prometida: string | null; atrasada: boolean;
};
type Area = { id: string; nombre: string; tipo: string; capacidad: number; color: string; orden: number };
type Conflicto = { mensaje: string; folio?: string };

export default function Planificador() {
  const [lunes, setLunes] = useState(lunesDe());
  const domingo = sumarDias(lunes, 7);
  const [modal, setModal] = useState<{ area_id?: string; dia?: string; hora?: string } | null>(null);
  const [detalle, setDetalle] = useState<Bloque | null>(null);
  const [resaltado, setResaltado] = useState<string | null>(null);

  const base = useCarga(async () => {
    const [config, areas, tecnicos] = await Promise.all([
      q(supabase.from('config').select('apertura, cierre, dias_laborables, margen_default_min, horneado_horas, curado_horas, cabina_max_piezas').eq('id', 1).single()),
      q<Area[]>(supabase.from('area').select('id, nombre, tipo, capacidad, color, orden').eq('activa', true).order('orden')),
      q(supabase.from('tecnico').select('id, nombre, especialidades, horario, activo').eq('activo', true).order('nombre')),
    ]);
    return { config, areas, tecnicos };
  }, []);

  const bloques = useCarga(async () => {
    const lo = desdeZona(lunes, '00:00').toISOString();
    const hi = desdeZona(domingo, '00:00').toISOString();
    return q<Bloque[]>(supabase.from('v_planificador').select('*').lt('inicio', hi).gt('fin', lo).order('inicio'));
  }, [lunes]);

  const actualizar = () => { bloques.recargar(); };

  if (base.cargando && !base.data) return <Cargando />;
  if (base.error) return <Aviso tipo="error">{base.error}</Aviso>;
  const { config, areas, tecnicos } = base.data!;
  const apertura = aMin(config.apertura.slice(0, 5));
  const cierre = aMin(config.cierre.slice(0, 5));
  const slotsDia = (cierre - apertura) / 30;
  const dias: string[] = [...config.dias_laborables].sort((a: number, b: number) => a - b).map((d: number) => sumarDias(lunes, d - 1));
  const atrasadas = new Set((bloques.data ?? []).filter((b) => b.atrasada).map((b) => b.orden_folio));

  return (
    <div>
      <Encabezado titulo="Planificador semanal" sub={`Semana del ${etiquetaDia(lunes)} · bloques de 30 min · ${config.apertura.slice(0, 5)}–${config.cierre.slice(0, 5)}`}>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, -7))} aria-label="Semana anterior">◀</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(lunesDe())}>Hoy</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente">▶</Boton>
        <Boton onClick={actualizar} cargando={bloques.cargando}>Actualizar</Boton>
        <Boton variante="primario" onClick={() => setModal({})}>+ Programar bloque</Boton>
      </Encabezado>

      {atrasadas.size > 0 && (
        <div className="mb-3"><Aviso tipo="atraso">Órdenes atrasadas esta semana: {[...atrasadas].join(', ')} — la última etapa programada supera la fecha prometida.</Aviso></div>
      )}
      {bloques.error && <div className="mb-3"><Aviso tipo="error">{bloques.error}</Aviso></div>}

      <Grilla areas={areas} dias={dias} apertura={apertura} slotsDia={slotsDia} bloques={bloques.data ?? []} resaltado={resaltado}
        onVacio={(area_id, dia, min) => setModal({ area_id, dia, hora: deMin(min) })} onBloque={setDetalle} />

      <Leyenda areas={areas} />

      {modal && (
        <ProgramarModal inicial={modal} dias={dias} apertura={apertura} cierre={cierre} config={config} areas={areas} tecnicos={tecnicos}
          onCerrar={() => { setModal(null); setResaltado(null); }}
          onConflicto={(folio) => { setResaltado(folio ?? null); bloques.recargar(); }}
          onActualizar={actualizar}
          onListo={() => { setModal(null); setResaltado(null); bloques.recargar(); }} />
      )}
      {detalle && <DetalleBloque b={detalle} onCerrar={() => setDetalle(null)} onCambio={() => { setDetalle(null); bloques.recargar(); }} />}
    </div>
  );
}

function Grilla({ areas, dias, apertura, slotsDia, bloques, resaltado, onVacio, onBloque }: {
  areas: Area[]; dias: string[]; apertura: number; slotsDia: number; bloques: Bloque[]; resaltado: string | null;
  onVacio: (area: string, dia: string, min: number) => void; onBloque: (b: Bloque) => void;
}) {
  const ancho = dias.length * slotsDia * W;
  const scroller = useRef<HTMLDivElement>(null);
  const ahora = enZona(new Date());
  const idxHoy = dias.indexOf(ahora.fecha);
  const xAhora = idxHoy >= 0 && ahora.min >= apertura && ahora.min <= apertura + slotsDia * 30 ? idxHoy * slotsDia * W + ((ahora.min - apertura) / 30) * W : null;

  useEffect(() => {
    if (scroller.current && xAhora != null) scroller.current.scrollLeft = Math.max(0, xAhora - 200);
  }, [xAhora != null]);

  const pos = (iso: string) => {
    const z = enZona(new Date(iso));
    const d = dias.indexOf(z.fecha);
    return d < 0 ? null : d * slotsDia * W + ((z.min - apertura) / 30) * W;
  };
  const anchoDe = (a: string, b: string) => ((new Date(b).getTime() - new Date(a).getTime()) / 1800000) * W;

  const filas = areas.flatMap((a) => Array.from({ length: a.capacidad }, (_, i) => ({ area: a, slot: i + 1 })));
  const fondo = {
    width: ancho,
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${W - 1}px, rgba(255,255,255,.04) ${W - 1}px ${W}px),
      repeating-linear-gradient(90deg, transparent 0 ${2 * W - 1}px, rgba(255,255,255,.09) ${2 * W - 1}px ${2 * W}px)`,
  };

  return (
    <div className="tarjeta flex overflow-hidden">
      {/* Columna fija de áreas */}
      <div className="w-36 shrink-0 border-r border-grafito-700 bg-grafito-900 sm:w-44">
        <div className="h-12 border-b border-grafito-700 px-3 pt-2 font-cond text-xs font-semibold uppercase tracking-wider text-grafito-400">Área</div>
        {filas.map(({ area, slot }) => (
          <div key={area.id + slot} style={{ height: ALTO }} className="flex items-center gap-2 border-b border-grafito-800 px-3">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: area.color }} />
            <span className="truncate font-cond text-sm font-semibold uppercase tracking-wide">{area.nombre}</span>
            {area.capacidad > 1 && <span className="font-mono text-[0.65rem] text-grafito-500">#{slot}</span>}
          </div>
        ))}
      </div>
      {/* Zona desplazable */}
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
        <div style={{ width: ancho }} className="relative">
          {/* Encabezado días / horas */}
          <div className="sticky top-0 h-12 border-b border-grafito-700 bg-grafito-900">
            {dias.map((d, i) => (
              <div key={d} className="absolute top-0 h-12 border-l border-grafito-600" style={{ left: i * slotsDia * W, width: slotsDia * W }}>
                <div className={`px-2 pt-1 font-cond text-xs font-bold uppercase tracking-wider ${d === ahora.fecha ? 'text-tiza' : 'text-grafito-300'}`}>{etiquetaDia(d)}</div>
                {Array.from({ length: slotsDia / 2 }, (_, h) => (
                  <div key={h} className="absolute bottom-1 font-mono text-[0.6rem] text-grafito-500" style={{ left: h * 2 * W + 2 }}>{deMin(apertura + h * 60).slice(0, 2)}</div>
                ))}
              </div>
            ))}
          </div>
          {/* Filas */}
          {filas.map(({ area, slot }) => (
            <div key={area.id + slot} style={{ ...fondo, height: ALTO }} className="relative cursor-crosshair border-b border-grafito-800"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const x = e.nativeEvent.offsetX;
                const idx = Math.floor(x / W);
                const d = Math.floor(idx / slotsDia);
                onVacio(area.id, dias[d], apertura + (idx % slotsDia) * 30);
              }}>
              {dias.map((d, i) => i > 0 && <div key={d} className="pointer-events-none absolute inset-y-0 border-l border-grafito-600" style={{ left: i * slotsDia * W }} />)}
              {bloques.filter((b) => b.area_id === area.id && b.slot === slot).map((b) => {
                const x = pos(b.inicio);
                if (x == null) return null;
                const w = anchoDe(b.inicio, b.fin);
                const wTec = b.fin_tecnico ? anchoDe(b.inicio, b.fin_tecnico) : w;
                const mant = b.tipo === 'mantenimiento';
                const terminado = b.etapa_estado === 'Terminada';
                const conflicto = resaltado === b.folio;
                return (
                  <button key={b.id} onClick={() => onBloque(b)} title={`${b.folio} · ${b.orden_folio ?? 'Mantenimiento'} · ${b.etapa_nombre ?? b.nota ?? ''} · ${hora(b.inicio)}–${hora(b.fin)}`}
                    className={`absolute top-1 bottom-1 overflow-hidden rounded-[4px] text-left text-grafito-950 shadow transition hover:z-10 hover:brightness-110
                      ${b.atrasada ? 'ring-2 ring-alerta' : ''} ${conflicto ? 'z-20 animate-pulse ring-4 ring-alerta' : ''} ${terminado ? 'opacity-50' : ''}
                      ${b.etapa_estado === 'Pausada' ? 'outline-dashed outline-2 outline-grafito-200' : ''}`}
                    style={{ left: x + 1, width: Math.max(w - 2, 8), background: mant ? '#5f6b76' : area.color }}>
                    {mant && <span className="rayas absolute inset-0" />}
                    {!mant && w > wTec && <span className="rayas absolute inset-y-0 right-0" style={{ width: w - wTec }} title="Horneado: cabina ocupada, técnico libre" />}
                    <span className="relative block truncate px-1.5 pt-0.5 font-mono text-[0.68rem] font-bold leading-tight">
                      {b.etapa_estado === 'En curso' && '● '}{mant ? 'MANT.' : b.orden_folio} {terminado && '✓'}
                    </span>
                    <span className="relative block truncate px-1.5 font-cond text-[0.7rem] font-semibold uppercase leading-tight">
                      {mant ? b.nota ?? 'Mantenimiento' : `${b.etapa_nombre}${b.etapa_tipo === 'pintura' ? ` c${b.carga}` : ''} · ${b.tecnico?.replace('Técnico ', 'T.')}`}
                    </span>
                    {b.atrasada && w >= 80 && <span className="absolute right-0 top-0 rounded-bl bg-alerta px-1 font-cond text-[0.55rem] font-bold uppercase">Atraso</span>}
                  </button>
                );
              })}
              {/* Márgenes: tramo rayado después del bloque */}
              {bloques.filter((b) => b.area_id === area.id && b.slot === slot && b.margen > 0).map((b) => {
                const x = pos(b.fin);
                return x == null ? null : <div key={b.id + 'm'} className="rayas-suaves pointer-events-none absolute top-2 bottom-2 rounded-r border border-dashed border-grafito-500" style={{ left: x, width: (b.margen / 30) * W }} title={`Margen ${b.margen} min`} />;
              })}
              {xAhora != null && <div className="pointer-events-none absolute inset-y-0 w-px bg-tiza/70" style={{ left: xAhora }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Leyenda({ areas }: { areas: Area[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-grafito-400">
      {areas.map((a) => <span key={a.id} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: a.color }} />{a.nombre}</span>)}
      <span className="flex items-center gap-1.5"><span className="rayas h-3 w-5 rounded-sm bg-grafito-500" />Horneado / mantenimiento</span>
      <span className="flex items-center gap-1.5"><span className="rayas-suaves h-3 w-5 rounded-sm border border-dashed border-grafito-500" />Margen</span>
      <span className="flex items-center gap-1.5">● En curso</span>
      <span className="flex items-center gap-1.5 opacity-60">✓ Terminada</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm ring-2 ring-alerta" />Atraso / conflicto</span>
      <span>Clic en un hueco para programar ahí.</span>
    </div>
  );
}

function ProgramarModal({ inicial, dias, apertura, cierre, config, areas, tecnicos, onCerrar, onConflicto, onActualizar, onListo }: {
  inicial: { area_id?: string; dia?: string; hora?: string }; dias: string[]; apertura: number; cierre: number; config: any;
  areas: Area[]; tecnicos: any[]; onCerrar: () => void; onConflicto: (folio?: string) => void; onActualizar: () => void; onListo: () => void;
}) {
  const [ordenId, setOrdenId] = useState('');
  const [etapaId, setEtapaId] = useState('');
  const [tecnicoId, setTecnicoId] = useState('');
  const [areaId, setAreaId] = useState(inicial.area_id ?? '');
  const [dia, setDia] = useState(inicial.dia ?? dias[0]);
  const [hhmm, setHhmm] = useState(inicial.hora ?? deMin(apertura));
  const [margen, setMargen] = useState<number>(config.margen_default_min ?? 0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);

  const ordenes = useCarga(() => q(supabase.from('v_orden_lista').select('id, folio, placa, cliente, tipo, estado, atrasada')
    .not('estado', 'in', '("Terminada","Entregada","Cancelada")').order('folio')), []);
  const etapas = useCarga(async () => ordenId
    ? q(supabase.from('etapa').select('id, tipo, secuencia, carga, area_tipo, especialidad, horas, piezas, estado').eq('orden_id', ordenId).order('secuencia').order('carga'))
    : [], [ordenId]);

  const etapa = (etapas.data ?? []).find((e: any) => e.id === etapaId);
  const tecs = tecnicos.filter((t) => !etapa || t.especialidades.includes(etapa.especialidad));
  const areasOk = areas.filter((a) => !etapa || a.tipo === etapa.area_tipo);

  useEffect(() => {
    const prox = (etapas.data ?? []).find((e: any) => e.estado === 'Pendiente');
    if (prox) setEtapaId(prox.id); else setEtapaId('');
  }, [etapas.data]);
  useEffect(() => {
    if (etapa && !areasOk.some((a) => a.id === areaId)) setAreaId(areasOk[0]?.id ?? '');
    if (etapa && !tecs.some((t) => t.id === tecnicoId)) setTecnicoId(tecs[0]?.id ?? '');
  }, [etapaId]);

  const horasSlot = useMemo(() => Array.from({ length: (cierre - apertura) / 30 }, (_, i) => deMin(apertura + i * 30)), [apertura, cierre]);
  const durMin = etapa ? Math.ceil(etapa.horas * 2) * 30 : 0;
  const horneo = etapa?.tipo === 'pintura' ? Number(config.horneado_horas) * 60 : 0;

  const enviar = async () => {
    setEnviando(true); setError(null); setConflicto(null);
    try {
      await operar('programar_bloque', {
        etapa_id: etapaId, tecnico_id: tecnicoId, area_id: areaId,
        inicio: desdeZona(dia, hhmm).toISOString(), margen,
      }, nuevoOpId());
      onListo();
    } catch (e) {
      const err = e as OpError;
      if (err.conflicto) { setConflicto({ mensaje: err.message.replace(/^Conflicto:\s*/, ''), folio: err.detalle?.folio }); onConflicto(err.detalle?.folio); }
      else setError(err.message);
    } finally { setEnviando(false); }
  };

  return (
    <Modal abierto titulo="Programar bloque" onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4">
        {conflicto && (
          <Aviso tipo="conflicto" accion={<Boton variante="alerta" onClick={() => { onActualizar(); setConflicto(null); }}>Actualizar</Boton>}>
            {conflicto.mensaje} No se ocupó ningún recurso. Actualizá el tablero y elegí otro horario.
          </Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Orden">
            <select className="campo" value={ordenId} onChange={(e) => setOrdenId(e.target.value)}>
              <option value="">Elegí una orden…</option>
              {(ordenes.data ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.folio} · {o.placa} · {o.cliente}{o.atrasada ? ' · ATRASADA' : ''}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Etapa">
            <select className="campo" value={etapaId} onChange={(e) => setEtapaId(e.target.value)} disabled={!ordenId}>
              <option value="">{ordenId ? 'Elegí la etapa…' : '—'}</option>
              {(etapas.data ?? []).map((e: any) => (
                <option key={e.id} value={e.id} disabled={e.estado !== 'Pendiente'}>
                  {e.secuencia}. {nombreEtapa(e.tipo)}{e.tipo === 'pintura' ? ` carga ${e.carga} (${e.piezas} pzas)` : ''} · {horas(e.horas)} · {e.estado}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Técnico" ayuda={etapa ? `Con especialidad «${etapa.especialidad}»` : undefined}>
            <select className="campo" value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
              <option value="">Elegí técnico…</option>
              {tecs.map((t) => <option key={t.id} value={t.id}>{t.nombre} · {t.horario.inicio}–{t.horario.fin}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Área">
            <select className="campo" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Elegí área…</option>
              {areasOk.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.capacidad > 1 ? ` (cap. ${a.capacidad})` : ''}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Día">
              <select className="campo" value={dia} onChange={(e) => setDia(e.target.value)}>
                {dias.map((d) => <option key={d} value={d}>{etiquetaDia(d)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Inicio (incluido)">
              <select className="campo" value={hhmm} onChange={(e) => setHhmm(e.target.value)}>
                {horasSlot.map((h) => <option key={h}>{h}</option>)}
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Margen (min)" ayuda="Holgura tras el fin: limpieza, traslado.">
            <input className="campo" type="number" min={0} max={240} step={15} value={margen} onChange={(e) => setMargen(Number(e.target.value))} />
          </Campo>
        </div>
        {etapa && (
          <div className="rounded-md border border-grafito-700 bg-grafito-900 px-4 py-3 font-mono text-xs text-grafito-300">
            {hhmm} → técnico hasta {deMin(aMin(hhmm) + durMin)}
            {horneo > 0 && <> · cabina hasta {deMin(aMin(hhmm) + durMin + horneo)} (horneado {horneo / 60} h, técnico libre)</>}
            {margen > 0 && <> · +{margen} min de margen</>}
            <span className="block text-grafito-500">Fin excluido: otro bloque puede empezar justo a esa hora. {etapa.tipo === 'pulido' && `El pulido exige ${config.curado_horas} h calendario de curado tras la pintura.`}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={enviar} cargando={enviando} disabled={!etapaId || !tecnicoId || !areaId}>Programar bloque</Boton>
        </div>
      </div>
    </Modal>
  );
}

const NOMBRES: Record<string, string> = { desarmado: 'Desarmado', hojalateria: 'Hojalatería', preparacion: 'Preparación', pintura: 'Pintura', pulido: 'Pulido', armado: 'Armado' };
export const nombreEtapa = (t: string) => NOMBRES[t] ?? t;

function DetalleBloque({ b, onCerrar, onCambio }: { b: Bloque; onCerrar: () => void; onCambio: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelar = async () => {
    if (!confirm(`¿Desprogramar el bloque ${b.folio}?`)) return;
    setEnviando(true); setError(null);
    try { await operar('cancelar_bloque', { bloque_id: b.id }); onCambio(); }
    catch (e: any) { setError(e.message); }
    finally { setEnviando(false); }
  };
  return (
    <Modal abierto titulo={`Bloque ${b.folio}`} onCerrar={onCerrar}>
      <div className="space-y-3 text-sm">
        {error && <Aviso tipo="error">{error}</Aviso>}
        {b.tipo === 'mantenimiento' ? (
          <p>Mantenimiento{b.nota ? `: ${b.nota}` : ''}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="folio text-base">{b.orden_folio}</span><span className="font-mono text-grafito-300">{b.placa}</span>
            {b.etapa_estado && <Estado valor={b.etapa_estado} />}{b.atrasada && <Atrasada />}
          </div>
        )}
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          {b.etapa_nombre && <><dt className="text-grafito-400">Etapa</dt><dd>{b.etapa_nombre}{b.etapa_tipo === 'pintura' ? ` · carga ${b.carga} (${b.piezas} piezas)` : ''} · {horas(b.horas)}</dd></>}
          {b.tecnico && <><dt className="text-grafito-400">Técnico</dt><dd>{b.tecnico}{b.fin_tecnico && b.fin_tecnico !== b.fin ? ` (libre desde ${hora(b.fin_tecnico)})` : ''}</dd></>}
          <dt className="text-grafito-400">Horario</dt><dd>{fechaHora(b.inicio)} → {hora(b.fin)}{b.margen ? ` +${b.margen} min margen` : ''}</dd>
          {b.fecha_prometida && <><dt className="text-grafito-400">Prometida</dt><dd className={b.atrasada ? 'font-semibold text-alerta' : ''}>{fechaHora(b.fecha_prometida)}</dd></>}
        </dl>
        <div className="flex justify-end gap-2 pt-2">
          {b.orden_id && <Link to={`/ordenes/${b.orden_id}`} className="rounded-md px-3 py-2 font-cond text-sm font-semibold uppercase tracking-wide text-grafito-300 hover:bg-grafito-800">Ver orden</Link>}
          <Boton onClick={cancelar} cargando={enviando}>Desprogramar</Boton>
        </div>
      </div>
    </Modal>
  );
}
