import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { operar, nuevoOpId } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { desdeZona, enZona, horas, sumarDias } from '@/lib/format';
import { Aviso, Boton, Campo, Encabezado } from '@/components/ui';

const DANOS = ['Leve', 'Medio', 'Fuerte', 'Reemplazo'] as const;
type Pieza = { nombre: string; dano: (typeof DANOS)[number] };
const clave = { Leve: 'h_leve', Medio: 'h_medio', Fuerte: 'h_fuerte', Reemplazo: 'h_reemplazo' } as const;

export default function NuevaOrden() {
  const nav = useNavigate();
  const hoy = enZona(new Date()).fecha;
  const [opId] = useState(nuevoOpId); // un op_id por formulario: doble clic no duplica la orden
  const [cliente, setCliente] = useState({ nombre: '', telefono: '', email: '' });
  const [placa, setPlaca] = useState('');
  const [tipo, setTipo] = useState<'Particular' | 'Aseguradora'>('Particular');
  const [aseguradora, setAseguradora] = useState('');
  const [deducible, setDeducible] = useState('');
  const [fecha, setFecha] = useState(sumarDias(hoy, 3));
  const [horaP, setHoraP] = useState('18:00');
  const [piezas, setPiezas] = useState<Pieza[]>([{ nombre: '', dano: 'Medio' }]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cat = useCarga(() => q<any[]>(supabase.from('catalogo_etapa').select('*').order('secuencia')), []);
  const estimado = useMemo(() => (cat.data ?? []).map((c) => ({
    nombre: c.nombre, horas: piezas.reduce((s, p) => s + Number(c[clave[p.dano]] ?? 0), 0),
  })).filter((x) => x.horas > 0), [cat.data, piezas]);

  const setPieza = (i: number, p: Partial<Pieza>) => setPiezas(piezas.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const guardar = async () => {
    setEnviando(true); setError(null);
    try {
      const r = await operar<{ orden_id: string }>('crear_orden', {
        cliente, placa, tipo, aseguradora: tipo === 'Aseguradora' ? aseguradora : null,
        deducible: tipo === 'Aseguradora' ? Number(deducible || 0) : 0,
        fecha_prometida: desdeZona(fecha, horaP).toISOString(),
        piezas: piezas.filter((p) => p.nombre.trim()),
      }, opId);
      nav(`/ordenes/${r.orden_id}`);
    } catch (e: any) { setError(e.message); setEnviando(false); }
  };

  return (
    <div className="max-w-4xl">
      <Encabezado titulo="Nueva orden" sub="Las etapas y el presupuesto se calculan en la base de datos con el catálogo vigente." />
      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          <section className="tarjeta grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="etiqueta sm:col-span-2 text-sm">Cliente y vehículo</h2>
            <Campo etiqueta="Cliente"><input className="campo" value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Teléfono (WhatsApp)"><input className="campo" inputMode="tel" placeholder="5215512345678" value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></Campo>
            <Campo etiqueta="Placa"><input className="campo font-mono uppercase" placeholder="ABC-123-D" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} /></Campo>
            <Campo etiqueta="Tipo">
              <div className="flex gap-2">
                {(['Particular', 'Aseguradora'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTipo(t)}
                    className={`flex-1 rounded-md border px-3 py-2 font-cond text-sm font-semibold uppercase tracking-wide ${tipo === t ? 'border-tiza bg-grafito-700 text-tiza' : 'border-grafito-600 text-grafito-400'}`}>{t}</button>
                ))}
              </div>
            </Campo>
            {tipo === 'Aseguradora' && <>
              <Campo etiqueta="Aseguradora"><input className="campo" value={aseguradora} onChange={(e) => setAseguradora(e.target.value)} /></Campo>
              <Campo etiqueta="Deducible (MXN)" ayuda="Lo paga el cliente; el resto, la aseguradora."><input className="campo" type="number" min={0} step="0.01" value={deducible} onChange={(e) => setDeducible(e.target.value)} /></Campo>
            </>}
            <Campo etiqueta="Fecha prometida"><input className="campo" type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
            <Campo etiqueta="Hora prometida"><input className="campo" type="time" step={1800} value={horaP} onChange={(e) => setHoraP(e.target.value)} /></Campo>
          </section>

          <section className="tarjeta p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="etiqueta text-sm">Piezas con daño</h2>
              <Boton variante="fantasma" onClick={() => setPiezas([...piezas, { nombre: '', dano: 'Leve' }])}>+ Pieza</Boton>
            </div>
            <div className="space-y-2">
              {piezas.map((p, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input className="campo min-w-[12rem] flex-1" placeholder="Ej.: Defensa delantera" value={p.nombre} onChange={(e) => setPieza(i, { nombre: e.target.value })} aria-label={`Pieza ${i + 1}`} />
                  <div className="flex overflow-hidden rounded-md border border-grafito-600" role="radiogroup" aria-label="Daño">
                    {DANOS.map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={p.dano === d} onClick={() => setPieza(i, { dano: d })}
                        className={`px-2.5 py-2 font-cond text-xs font-semibold uppercase ${p.dano === d ? 'bg-tiza text-grafito-950' : 'text-grafito-400 hover:bg-grafito-800'}`}>{d}</button>
                    ))}
                  </div>
                  <Boton variante="fantasma" onClick={() => setPiezas(piezas.filter((_, j) => j !== i))} disabled={piezas.length === 1} aria-label="Quitar pieza">✕</Boton>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="tarjeta h-fit p-5">
          <h2 className="etiqueta text-sm">Etapas estimadas</h2>
          <ol className="mt-2 space-y-1 text-sm">
            {estimado.map((e, i) => <li key={e.nombre} className="flex justify-between"><span>{i + 1}. {e.nombre}</span><span className="font-mono text-grafito-300">{horas(e.horas)}</span></li>)}
          </ol>
          <div className="mt-3 flex justify-between border-t border-grafito-700 pt-2 text-sm font-semibold">
            <span>Total</span><span className="font-mono">{horas(estimado.reduce((s, e) => s + e.horas, 0))}</span>
          </div>
          <p className="mt-3 text-xs text-grafito-400">La pintura se parte en cargas de cabina de hasta 6 piezas. Se programa con 50% de anticipo (particular) o presupuesto autorizado (aseguradora).</p>
          <Boton variante="primario" className="mt-4 w-full" onClick={guardar} cargando={enviando}>Crear orden</Boton>
        </aside>
      </div>
    </div>
  );
}
