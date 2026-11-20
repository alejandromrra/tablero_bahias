import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { nuevoOpId, operar, rpc } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { DIAS, desdeZona, enZona, fechaHora, sumarDias } from '@/lib/format';
import { Aviso, Boton, Campo, Cargando, Encabezado } from '@/components/ui';

const PESTANAS = ['Tarifas', 'Horas por etapa', 'Áreas', 'Técnicos', 'Mantenimiento', 'Usuarios'] as const;
type Msg = { tipo: 'ok' | 'error'; texto: string } | null;

export default function Configuracion() {
  const [tab, setTab] = useState<(typeof PESTANAS)[number]>('Tarifas');
  return (
    <div className="max-w-5xl">
      <Encabezado titulo="Configuración" sub="Solo gerencia. Los cambios de tarifas y horas aplican a órdenes nuevas." />
      <div className="mb-5 flex flex-wrap gap-1 border-b border-grafito-700">
        {PESTANAS.map((p) => (
          <button key={p} onClick={() => setTab(p)}
            className={`-mb-px border-b-2 px-3 py-2 font-cond text-sm font-semibold uppercase tracking-wide ${tab === p ? 'border-tiza text-tiza' : 'border-transparent text-grafito-400 hover:text-tiza'}`}>{p}</button>
        ))}
      </div>
      {tab === 'Tarifas' && <Tarifas />}
      {tab === 'Horas por etapa' && <Catalogo />}
      {tab === 'Áreas' && <Areas />}
      {tab === 'Técnicos' && <Tecnicos />}
      {tab === 'Mantenimiento' && <Mantenimiento />}
      {tab === 'Usuarios' && <Usuarios />}
    </div>
  );
}

function useGuardar() {
  const [msg, setMsg] = useState<Msg>(null);
  const [enviando, setEnviando] = useState(false);
  const guardar = async (tipo: string, payload: any, ok = 'Guardado.') => {
    setEnviando(true); setMsg(null);
    try { const r = await operar(tipo, payload, nuevoOpId()); setMsg({ tipo: 'ok', texto: ok }); return r; }
    catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); return null; }
    finally { setEnviando(false); }
  };
  return { msg, enviando, guardar, aviso: msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div> };
}

function Tarifas() {
  const { data, cargando, recargar } = useCarga(async () => ({
    c: await q<any>(supabase.from('config').select('*').eq('id', 1).single()),
    f: await q<any>(supabase.from('config_finanzas').select('*').eq('id', 1).single()),
  }), []);
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) { setC(data.c); setF(data.f); } }, [data]);
  const g = useGuardar();
  if (cargando || !c || !f) return <Cargando />;
  const num = (obj: any, set: any, k: string, et: string, step = '0.01', ayuda?: string) => (
    <Campo etiqueta={et} ayuda={ayuda}><input className="campo font-mono" type="number" step={step} value={obj[k]} onChange={(e) => set({ ...obj, [k]: e.target.value })} /></Campo>
  );
  return (
    <div>
      {g.aviso}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="tarjeta grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="etiqueta text-sm sm:col-span-2">Precios y reglas</h2>
          {num(c, setC, 'tarifa_mo', 'Mano de obra $/h')}
          {num(c, setC, 'iva', 'IVA (0,16 = 16%)')}
          {num(c, setC, 'anticipo_pct', 'Anticipo (0,50 = 50%)')}
          {num(c, setC, 'cabina_max_piezas', 'Cabina: máx piezas/carga', '1')}
          {num(c, setC, 'horneado_horas', 'Horneado (h)', '0.5')}
          {num(c, setC, 'curado_horas', 'Curado (h calendario)', '0.5')}
          {num(c, setC, 'margen_default_min', 'Margen por defecto (min)', '15')}
        </section>
        <section className="tarjeta grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="etiqueta text-sm sm:col-span-2">Finanzas internas</h2>
          {num(f, setF, 'markup_refacciones', 'Markup refacciones (0,15)')}
          {num(f, setF, 'bono_hora', 'Bono $/h')}
          {num(f, setF, 'umbral_bono_horas', 'Umbral bono (h/semana)', '1')}
          <h2 className="etiqueta mt-2 text-sm sm:col-span-2">Horario del taller</h2>
          <Campo etiqueta="Apertura"><input className="campo" type="time" step={1800} value={c.apertura.slice(0, 5)} onChange={(e) => setC({ ...c, apertura: e.target.value })} /></Campo>
          <Campo etiqueta="Cierre"><input className="campo" type="time" step={1800} value={c.cierre.slice(0, 5)} onChange={(e) => setC({ ...c, cierre: e.target.value })} /></Campo>
          <div className="sm:col-span-2">
            <span className="etiqueta">Días laborables</span>
            <DiasSel valor={c.dias_laborables} onChange={(d) => setC({ ...c, dias_laborables: d })} />
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-end">
        <Boton variante="primario" cargando={g.enviando} onClick={async () => {
          const { tarifa_mo, iva, anticipo_pct, cabina_max_piezas, horneado_horas, curado_horas, margen_default_min, apertura, cierre, dias_laborables } = c;
          await g.guardar('guardar_config', {
            config: { tarifa_mo, iva, anticipo_pct, cabina_max_piezas, horneado_horas, curado_horas, margen_default_min, apertura, cierre, dias_laborables },
            finanzas: { markup_refacciones: f.markup_refacciones, bono_hora: f.bono_hora, umbral_bono_horas: f.umbral_bono_horas },
          });
          recargar();
        }}>Guardar tarifas</Boton>
      </div>
    </div>
  );
}

function DiasSel({ valor, onChange }: { valor: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <button key={d} type="button" onClick={() => onChange(valor.includes(d) ? valor.filter((x) => x !== d) : [...valor, d].sort())}
          className={`rounded px-2.5 py-1.5 font-cond text-xs font-semibold uppercase ${valor.includes(d) ? 'bg-tiza text-grafito-950' : 'bg-grafito-800 text-grafito-400'}`}>{DIAS[d]}</button>
      ))}
    </div>
  );
}

function Catalogo() {
  const { data, cargando, recargar } = useCarga(() => q<any[]>(supabase.from('catalogo_etapa').select('*').order('secuencia')), []);
  const [filas, setFilas] = useState<any[]>([]);
  useEffect(() => { if (data) setFilas(data); }, [data]);
  const g = useGuardar();
  if (cargando) return <Cargando />;
  const set = (i: number, k: string, v: string) => setFilas(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  return (
    <div>
      {g.aviso}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla min-w-[720px]">
          <thead><tr><th>#</th><th>Etapa</th><th>Especialidad</th><th>Leve</th><th>Medio</th><th>Fuerte</th><th>Reemplazo</th><th>Materiales $/h</th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.tipo}>
                <td className="font-mono">{f.secuencia}</td><td className="font-semibold">{f.nombre}</td><td className="text-grafito-400">{f.especialidad} · {f.area_tipo}</td>
                {['h_leve', 'h_medio', 'h_fuerte', 'h_reemplazo', 'material_hora'].map((k) => (
                  <td key={k}><input className="campo w-20 px-2 py-1 font-mono" type="number" step="0.5" min={0} value={f[k]} onChange={(e) => set(i, k, e.target.value)} aria-label={`${f.nombre} ${k}`} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-grafito-400">Horas por pieza según el daño. La secuencia es fija: desarmado → hojalatería → preparación → pintura (cabina) → curado → pulido → armado.</p>
      </div>
      <div className="mt-4 flex justify-end"><Boton variante="primario" cargando={g.enviando} onClick={async () => { await g.guardar('guardar_catalogo', { etapas: filas }); recargar(); }}>Guardar horas</Boton></div>
    </div>
  );
}

function Areas() {
  const { data, cargando, recargar } = useCarga(() => q<any[]>(supabase.from('area').select('*').order('orden')), []);
  const [ed, setEd] = useState<any | null>(null);
  const g = useGuardar();
  if (cargando) return <Cargando />;
  return (
    <div>
      {g.aviso}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Color</th><th>Nombre</th><th>Tipo</th><th>Capacidad</th><th>Activa</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td><span className="inline-block h-4 w-8 rounded-sm" style={{ background: a.color }} /></td>
                <td className="font-semibold">{a.nombre}</td><td>{a.tipo}</td><td className="font-mono">{a.capacidad}</td><td>{a.activa ? 'Sí' : 'No'}</td>
                <td className="text-right"><Boton variante="fantasma" onClick={() => setEd({ ...a })}>Editar</Boton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><Boton onClick={() => setEd({ nombre: '', tipo: 'bahia', capacidad: 1, color: '#94a3b8', orden: 99, activa: true })}>+ Área</Boton></div>
      {ed && (
        <section className="tarjeta mt-4 grid gap-4 p-5 sm:grid-cols-3">
          <Campo etiqueta="Nombre"><input className="campo" value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Tipo">
            <select className="campo" value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value })}>
              {['bahia', 'preparacion', 'cabina', 'pulido'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Capacidad (simultáneos)"><input className="campo" type="number" min={1} max={10} value={ed.capacidad} onChange={(e) => setEd({ ...ed, capacidad: e.target.value })} /></Campo>
          <Campo etiqueta="Color"><input className="campo h-10 p-1" type="color" value={ed.color} onChange={(e) => setEd({ ...ed, color: e.target.value })} /></Campo>
          <Campo etiqueta="Orden en tablero"><input className="campo" type="number" value={ed.orden} onChange={(e) => setEd({ ...ed, orden: e.target.value })} /></Campo>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={ed.activa} onChange={(e) => setEd({ ...ed, activa: e.target.checked })} /> Activa</label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Boton variante="fantasma" onClick={() => setEd(null)}>Cancelar</Boton>
            <Boton variante="primario" cargando={g.enviando} onClick={async () => { if (await g.guardar('guardar_area', ed)) { setEd(null); recargar(); } }}>Guardar área</Boton>
          </div>
        </section>
      )}
    </div>
  );
}

const ESPECIALIDADES = ['armado', 'hojalateria', 'preparacion', 'pintura', 'pulido'];

function Tecnicos() {
  const { data, cargando, recargar } = useCarga(() => rpc<any[]>('tecnicos_admin'), []);
  const [ed, setEd] = useState<any | null>(null);
  const g = useGuardar();
  if (cargando) return <Cargando />;
  return (
    <div>
      {g.aviso}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla min-w-[640px]">
          <thead><tr><th>Técnico</th><th>Especialidades</th><th>Horario</th><th className="text-right">Tarifa (costo)</th><th>Activo</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">{t.nombre}</td><td className="text-grafito-300">{t.especialidades.join(', ')}</td>
                <td className="font-mono text-xs">{t.horario.dias.map((d: number) => DIAS[d]).join(' ')} · {t.horario.inicio}–{t.horario.fin}</td>
                <td className="text-right font-mono">${Number(t.tarifa_hora).toFixed(2)}</td><td>{t.activo ? 'Sí' : 'No'}</td>
                <td className="text-right"><Boton variante="fantasma" onClick={() => setEd(structuredClone(t))}>Editar</Boton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><Boton onClick={() => setEd({ nombre: '', especialidades: [], tarifa_hora: 100, horario: { dias: [1, 2, 3, 4, 5, 6], inicio: '08:00', fin: '17:00' }, activo: true })}>+ Técnico</Boton></div>
      {ed && (
        <section className="tarjeta mt-4 grid gap-4 p-5 sm:grid-cols-3">
          <Campo etiqueta="Nombre"><input className="campo" value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Tarifa $/h (costo)"><input className="campo font-mono" type="number" step="0.01" value={ed.tarifa_hora} onChange={(e) => setEd({ ...ed, tarifa_hora: e.target.value })} /></Campo>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} /> Activo</label>
          <div className="sm:col-span-3">
            <span className="etiqueta">Especialidades</span>
            <div className="flex flex-wrap gap-1">
              {ESPECIALIDADES.map((s) => (
                <button key={s} type="button" onClick={() => setEd({ ...ed, especialidades: ed.especialidades.includes(s) ? ed.especialidades.filter((x: string) => x !== s) : [...ed.especialidades, s] })}
                  className={`rounded px-2.5 py-1.5 font-cond text-xs font-semibold uppercase ${ed.especialidades.includes(s) ? 'bg-tiza text-grafito-950' : 'bg-grafito-800 text-grafito-400'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2"><span className="etiqueta">Días</span><DiasSel valor={ed.horario.dias} onChange={(d) => setEd({ ...ed, horario: { ...ed.horario, dias: d } })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Entra"><input className="campo" type="time" step={1800} value={ed.horario.inicio} onChange={(e) => setEd({ ...ed, horario: { ...ed.horario, inicio: e.target.value } })} /></Campo>
            <Campo etiqueta="Sale"><input className="campo" type="time" step={1800} value={ed.horario.fin} onChange={(e) => setEd({ ...ed, horario: { ...ed.horario, fin: e.target.value } })} /></Campo>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Boton variante="fantasma" onClick={() => setEd(null)}>Cancelar</Boton>
            <Boton variante="primario" cargando={g.enviando} onClick={async () => { if (await g.guardar('guardar_tecnico', ed)) { setEd(null); recargar(); } }}>Guardar técnico</Boton>
          </div>
        </section>
      )}
    </div>
  );
}

function Mantenimiento() {
  const hoy = enZona(new Date()).fecha;
  const areas = useCarga(() => q<any[]>(supabase.from('area').select('id, nombre').eq('activa', true).order('orden')), []);
  const lista = useCarga(() => q<any[]>(supabase.from('bloque').select('id, folio, area_id, inicio, fin, nota').eq('tipo', 'mantenimiento').gte('fin', new Date().toISOString()).order('inicio')), []);
  const [f, setF] = useState({ area_id: '', dia: sumarDias(hoy, 1), desde: '08:00', hasta: '10:00', nota: '' });
  const g = useGuardar();
  const nombre = (id: string) => areas.data?.find((a) => a.id === id)?.nombre ?? '';
  return (
    <div>
      {g.aviso}
      <section className="tarjeta mb-5 grid gap-4 p-5 sm:grid-cols-5 sm:items-end">
        <Campo etiqueta="Área">
          <select className="campo" value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}>
            <option value="">Elegí…</option>{(areas.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Día"><input className="campo" type="date" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} /></Campo>
        <Campo etiqueta="Desde"><input className="campo" type="time" step={1800} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></Campo>
        <Campo etiqueta="Hasta"><input className="campo" type="time" step={1800} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></Campo>
        <Campo etiqueta="Motivo"><input className="campo" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Campo>
        <div className="sm:col-span-5 flex justify-end">
          <Boton variante="primario" disabled={!f.area_id} cargando={g.enviando} onClick={async () => {
            if (await g.guardar('programar_mantenimiento', { area_id: f.area_id, inicio: desdeZona(f.dia, f.desde).toISOString(), fin: desdeZona(f.dia, f.hasta).toISOString(), nota: f.nota }, 'Mantenimiento programado: el área queda ocupada.')) lista.recargar();
          }}>Programar mantenimiento</Boton>
        </div>
      </section>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Bloque</th><th>Área</th><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead>
          <tbody>
            {(lista.data ?? []).map((b) => (
              <tr key={b.id}><td className="folio">{b.folio}</td><td>{nombre(b.area_id)}</td><td>{fechaHora(b.inicio)}</td><td>{fechaHora(b.fin)}</td><td>{b.nota}</td>
                <td className="text-right"><Boton variante="fantasma" onClick={async () => { if (await g.guardar('cancelar_bloque', { bloque_id: b.id }, 'Mantenimiento cancelado.')) lista.recargar(); }}>Quitar</Boton></td></tr>
            ))}
            {(lista.data ?? []).length === 0 && <tr><td colSpan={6} className="text-grafito-500">Sin mantenimientos próximos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Usuarios() {
  const { data, cargando } = useCarga(() => q<any[]>(supabase.from('perfil').select('user_id, nombre, rol, tecnico_id').order('rol')), []);
  if (cargando) return <Cargando />;
  return (
    <div>
      <Aviso tipo="info">Cada usuario tiene un solo rol. El rol no se edita desde la app: se asigna en la base de datos (tabla <code>perfil</code>) con acceso de administrador.</Aviso>
      <div className="tarjeta mt-4 overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Rol</th></tr></thead>
          <tbody>{(data ?? []).map((p) => <tr key={p.user_id}><td>{p.nombre}</td><td className="font-cond uppercase tracking-wide">{p.rol}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
