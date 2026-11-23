import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { operar } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { useAuth } from '@/lib/auth';
import { desdeZona, fechaHora, hora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Aviso, Cargando, Estado } from '@/components/ui';

// Vista de piso: una columna, botones grandes, sin importes. Una tarjeta por etapa (con sus tramos).
export default function VistaTecnico() {
  const { perfil } = useAuth();
  const esGerencia = perfil?.rol === 'gerencia';
  const [tecnicoSel, setTecnicoSel] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const tecnicos = useCarga(() => (esGerencia ? q<any[]>(supabase.from('tecnico').select('id, nombre').order('nombre')) : Promise.resolve([])), [esGerencia]);
  const tid = esGerencia ? tecnicoSel : perfil?.tecnico_id ?? '';

  const datos = useCarga(async () => {
    if (!tid) return { tarjetas: [], etapas: [], areas: [] as any[] };
    const desde = desdeZona(sumarDias(lunesDe(), -7), '00:00').toISOString();
    const hasta = desdeZona(sumarDias(lunesDe(), 14), '00:00').toISOString();
    const bloques = await q<any[]>(supabase.from('v_planificador')
      .select('id, folio, inicio, fin, fin_tecnico, area_id, tramo, tramos, etapa_id, etapa_tipo, etapa_nombre, etapa_estado, carga, piezas, horas, orden_id, orden_folio, placa')
      .eq('tipo', 'trabajo').eq('tecnico_id', tid).gte('fin', desde).lt('inicio', hasta).order('inicio'));
    const porEtapa = new Map<string, any>();
    for (const b of bloques) {
      const t = porEtapa.get(b.etapa_id) ?? { ...b, tramosLista: [] };
      t.tramosLista.push(b); porEtapa.set(b.etapa_id, t);
    }
    const ordenes = [...new Set(bloques.map((b) => b.orden_id))];
    const [etapas, areas] = await Promise.all([
      ordenes.length ? q<any[]>(supabase.from('etapa').select('id, orden_id, tipo, secuencia, estado').in('orden_id', ordenes)) : Promise.resolve([]),
      q<any[]>(supabase.from('area').select('id, nombre, color')),
    ]);
    return { tarjetas: [...porEtapa.values()], etapas, areas };
  }, [tid]);

  const accion = async (etapa_id: string, acc: 'iniciar' | 'pausar' | 'terminar') => {
    setOcupado(etapa_id + acc); setMsg(null);
    try {
      const r = await operar<any>('etapa_accion', { etapa_id, accion: acc });
      setMsg({ tipo: 'ok', texto: `Listo: etapa ${r.estado}.` });
      datos.recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setOcupado(null); }
  };

  const d = datos.data;
  const activas = (d?.tarjetas ?? []).filter((b) => b.etapa_estado !== 'Terminada');
  const hechas = (d?.tarjetas ?? []).filter((b) => b.etapa_estado === 'Terminada');
  const faltaAnterior = (b: any) => {
    const sec = d?.etapas.find((x: any) => x.id === b.etapa_id)?.secuencia ?? 0;
    return (d?.etapas ?? []).some((e: any) => e.orden_id === b.orden_id && e.secuencia < sec && e.estado !== 'Terminada');
  };
  const area = (id: string) => d?.areas?.find((a: any) => a.id === id);

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="titulo">Mi trabajo</h1>
        <button onClick={datos.recargar} className="rounded-md border border-grafito-300 bg-white px-4 py-3 font-cond text-base font-semibold uppercase">Actualizar</button>
      </div>
      {esGerencia && (
        <select className="campo mb-4 py-3 text-base" value={tecnicoSel} onChange={(e) => setTecnicoSel(e.target.value)} aria-label="Técnico">
          <option value="">Elegí técnico…</option>
          {(tecnicos.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      )}
      {msg && <div className="mb-4 text-base"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
      {datos.cargando && !d ? <Cargando /> : (
        <div className="space-y-4">
          {activas.length === 0 && <p className="tarjeta p-6 text-center text-lg text-grafito-500">No tenés etapas pendientes.</p>}
          {activas.map((b) => {
            const espera = faltaAnterior(b);
            const a = area(b.area_id);
            return (
              <article key={b.etapa_id} className={`tarjeta overflow-hidden ${b.etapa_estado === 'En curso' ? 'border-2 border-grafito-900' : ''}`}>
                <div className="h-3" style={{ background: a?.color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-cond text-3xl font-bold">{b.orden_folio}</div>
                      <div className="font-mono text-xl text-grafito-600">{b.placa}</div>
                    </div>
                    <Estado valor={b.etapa_estado} />
                  </div>
                  <div className="mt-3 font-cond text-2xl font-bold uppercase tracking-wide">{b.etapa_nombre}{b.etapa_tipo === 'pintura' ? ` · ${b.piezas} piezas` : ''}</div>
                  <div className="text-base text-grafito-600">{a?.nombre} · {horas(b.horas)}</div>
                  <ul className="mt-1 text-base text-grafito-700">
                    {b.tramosLista.map((t: any) => <li key={t.id}>{fechaHora(t.inicio)} → {hora(t.fin_tecnico ?? t.fin)}</li>)}
                  </ul>
                  {b.etapa_tipo === 'pintura' && <div className="text-sm text-grafito-500">Después del pintado sigue 1 h de horneado: quedás libre.</div>}
                  {espera && <div className="mt-2 text-base text-grafito-500">Esperando que termine la etapa anterior.</div>}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <BotonGrande onClick={() => accion(b.etapa_id, 'iniciar')} activo={['Programada', 'Pausada'].includes(b.etapa_estado) && !espera} cargando={ocupado === b.etapa_id + 'iniciar'} clase="bg-azul text-white">En curso</BotonGrande>
                    <BotonGrande onClick={() => accion(b.etapa_id, 'pausar')} activo={b.etapa_estado === 'En curso'} cargando={ocupado === b.etapa_id + 'pausar'} clase="bg-grafito-600 text-white">Pausar</BotonGrande>
                    <BotonGrande onClick={() => accion(b.etapa_id, 'terminar')} activo={['En curso', 'Pausada'].includes(b.etapa_estado)} cargando={ocupado === b.etapa_id + 'terminar'} clase="bg-verde text-white">Terminar</BotonGrande>
                  </div>
                </div>
              </article>
            );
          })}
          {hechas.length > 0 && (
            <details className="tarjeta p-4">
              <summary className="cursor-pointer font-cond text-base font-semibold uppercase tracking-wide text-grafito-600">Terminadas ({hechas.length})</summary>
              <ul className="mt-2 space-y-1 text-base text-grafito-500">
                {hechas.map((b) => <li key={b.etapa_id}>{b.orden_folio} · {b.etapa_nombre} · {fechaHora(b.inicio)}</li>)}
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
      className={`h-20 rounded-lg font-cond text-xl font-bold uppercase tracking-wide shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:bg-grafito-100 disabled:text-grafito-300 disabled:shadow-none ${clase}`}>
      {cargando ? '…' : children}
    </button>
  );
}
