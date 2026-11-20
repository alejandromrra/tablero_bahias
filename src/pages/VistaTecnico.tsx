import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { operar } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { useAuth } from '@/lib/auth';
import { desdeZona, fechaHora, hora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Aviso, Cargando, Estado } from '@/components/ui';

// Vista de una columna para el piso: sin importes, botones grandes.
export default function VistaTecnico() {
  const { perfil } = useAuth();
  const esGerencia = perfil?.rol === 'gerencia';
  const [tecnicoSel, setTecnicoSel] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const tecnicos = useCarga(() => (esGerencia ? q<any[]>(supabase.from('tecnico').select('id, nombre').order('nombre')) : Promise.resolve([])), [esGerencia]);
  const tid = esGerencia ? tecnicoSel : perfil?.tecnico_id ?? '';

  const datos = useCarga(async () => {
    if (!tid) return { bloques: [], etapas: [] };
    const desde = desdeZona(lunesDe(), '00:00').toISOString();
    const hasta = desdeZona(sumarDias(lunesDe(), 14), '00:00').toISOString();
    const bloques = await q<any[]>(supabase.from('v_planificador')
      .select('id, folio, inicio, fin, fin_tecnico, area_id, etapa_id, etapa_tipo, etapa_nombre, etapa_estado, carga, piezas, horas, orden_id, orden_folio, placa')
      .eq('tipo', 'trabajo').eq('tecnico_id', tid).gte('fin', desde).lt('inicio', hasta).order('inicio'));
    const ordenes = [...new Set(bloques.map((b) => b.orden_id))];
    const [etapas, areas] = await Promise.all([
      ordenes.length ? q<any[]>(supabase.from('etapa').select('id, orden_id, tipo, secuencia, estado').in('orden_id', ordenes)) : Promise.resolve([]),
      q<any[]>(supabase.from('area').select('id, nombre, color')),
    ]);
    return { bloques, etapas, areas };
  }, [tid]);

  const accion = async (etapa_id: string, acc: 'iniciar' | 'pausar' | 'terminar') => {
    setOcupado(etapa_id + acc); setMsg(null);
    try {
      const r = await operar<any>('etapa_accion', { etapa_id, accion: acc });
      setMsg({ tipo: 'ok', texto: `Etapa ${r.estado}.` });
      datos.recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setOcupado(null); }
  };

  const d = datos.data;
  const activos = (d?.bloques ?? []).filter((b) => b.etapa_estado !== 'Terminada');
  const hechos = (d?.bloques ?? []).filter((b) => b.etapa_estado === 'Terminada');
  const faltaAnterior = (b: any) => (d?.etapas ?? []).some((e) => e.orden_id === b.orden_id && e.secuencia < (d!.etapas.find((x) => x.id === b.etapa_id)?.secuencia ?? 0) && e.estado !== 'Terminada');
  const area = (id: string) => d?.areas?.find((a: any) => a.id === id);

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="titulo">Mi trabajo</h1>
        <button onClick={datos.recargar} className="rounded-md border border-grafito-600 px-4 py-2 font-cond text-sm font-semibold uppercase">Actualizar</button>
      </div>
      {esGerencia && (
        <select className="campo mb-4" value={tecnicoSel} onChange={(e) => setTecnicoSel(e.target.value)} aria-label="Técnico">
          <option value="">Elegí técnico…</option>
          {(tecnicos.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      )}
      {msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
      {datos.cargando && !d ? <Cargando /> : (
        <div className="space-y-4">
          {activos.length === 0 && <p className="tarjeta p-6 text-center text-grafito-400">No tenés bloques pendientes esta semana ni la próxima.</p>}
          {activos.map((b) => {
            const bloqueado = b.etapa_estado === 'Bloqueada';
            const espera = faltaAnterior(b);
            const a = area(b.area_id);
            return (
              <article key={b.id} className={`tarjeta overflow-hidden ${b.etapa_estado === 'En curso' ? 'border-yellow-300' : ''}`}>
                <div className="h-2" style={{ background: a?.color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-2xl font-bold">{b.orden_folio}</div>
                      <div className="font-mono text-lg text-grafito-300">{b.placa}</div>
                    </div>
                    <Estado valor={b.etapa_estado} />
                  </div>
                  <div className="mt-3 font-cond text-2xl font-bold uppercase tracking-wide">{b.etapa_nombre}{b.etapa_tipo === 'pintura' ? ` · ${b.piezas} piezas` : ''}</div>
                  <div className="mt-1 text-base text-grafito-300">{fechaHora(b.inicio)} → {hora(b.fin_tecnico ?? b.fin)} · {horas(b.horas)} · {a?.nombre}</div>
                  {b.etapa_tipo === 'pintura' && <div className="text-sm text-grafito-400">Después sigue 1 h de horneado: quedás libre.</div>}
                  {bloqueado && <div className="mt-2 text-sm text-violet-300">Bloqueada: faltan refacciones.</div>}
                  {espera && !bloqueado && <div className="mt-2 text-sm text-grafito-400">Esperando que termine la etapa anterior.</div>}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <BotonGrande onClick={() => accion(b.etapa_id, 'iniciar')} activo={['Programada', 'Pausada'].includes(b.etapa_estado) && !espera} cargando={ocupado === b.etapa_id + 'iniciar'} clase="bg-yellow-300 text-grafito-950">En curso</BotonGrande>
                    <BotonGrande onClick={() => accion(b.etapa_id, 'pausar')} activo={b.etapa_estado === 'En curso'} cargando={ocupado === b.etapa_id + 'pausar'} clase="bg-grafito-600 text-tiza">Pausar</BotonGrande>
                    <BotonGrande onClick={() => accion(b.etapa_id, 'terminar')} activo={['En curso', 'Pausada'].includes(b.etapa_estado)} cargando={ocupado === b.etapa_id + 'terminar'} clase="bg-emerald-400 text-grafito-950">Terminar</BotonGrande>
                  </div>
                </div>
              </article>
            );
          })}
          {hechos.length > 0 && (
            <details className="tarjeta p-4">
              <summary className="cursor-pointer font-cond text-sm font-semibold uppercase tracking-wide text-grafito-300">Terminadas ({hechos.length})</summary>
              <ul className="mt-2 space-y-1 text-sm text-grafito-400">
                {hechos.map((b) => <li key={b.id}>{b.orden_folio} · {b.etapa_nombre} · {fechaHora(b.inicio)}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function BotonGrande({ children, onClick, activo, cargando, clase }: { children: string; onClick: () => void; activo: boolean; cargando: boolean; clase: string }) {
  return (
    <button onClick={onClick} disabled={!activo || cargando}
      className={`h-16 rounded-lg font-cond text-lg font-bold uppercase tracking-wide transition active:scale-95 disabled:cursor-not-allowed disabled:bg-grafito-800 disabled:text-grafito-600 ${clase}`}>
      {cargando ? '…' : children}
    </button>
  );
}
