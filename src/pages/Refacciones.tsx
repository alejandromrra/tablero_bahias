import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { nuevoOpId, operar, rpc } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { useAuth } from '@/lib/auth';
import { dinero, fechaHora } from '@/lib/format';
import { Aviso, Boton, Campo, Cargando, Encabezado, Estado } from '@/components/ui';

export default function Refacciones() {
  const { perfil } = useAuth();
  const ger = perfil?.rol === 'gerencia';
  const [params] = useSearchParams();
  const [ordenId, setOrdenId] = useState(params.get('orden') ?? '');
  const [nombre, setNombre] = useState('');
  const [costo, setCosto] = useState('');
  const [opAlta, setOpAlta] = useState(nuevoOpId);
  const [soloPend, setSoloPend] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const ordenes = useCarga(() => q<any[]>(supabase.from('v_orden_lista').select('id, folio, placa, cliente, estado').not('estado', 'in', '("Terminada","Entregada","Cancelada")').order('folio')), []);
  const lista = useCarga(() => rpc<any[]>('refacciones_listado'), []);

  const alta = async () => {
    setOcupado('alta'); setMsg(null);
    try {
      const r = await operar<any>('alta_refaccion', { orden_id: ordenId, nombre, costo: Number(costo) }, opAlta);
      setMsg({ tipo: 'ok', texto: `Refacción dada de alta · precio al cliente ${dinero(r.precio_venta)}. El armado queda bloqueado hasta recibirla.` });
      setNombre(''); setCosto(''); setOpAlta(nuevoOpId()); lista.recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setOcupado(null); }
  };
  const recibir = async (id: string) => {
    setOcupado(id); setMsg(null);
    try {
      const r = await operar<any>('recibir_refaccion', { refaccion_id: id });
      setMsg({ tipo: 'ok', texto: r.pendientes === 0 ? `Última refacción recibida: la orden vuelve a «${r.orden_estado}» y el armado se habilita.` : `Recibida. Faltan ${r.pendientes}.` });
      lista.recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setOcupado(null); }
  };

  const filas = (lista.data ?? []).filter((r) => (!soloPend || r.estado !== 'Recibida') && (!params.get('orden') || r.orden_id === params.get('orden')));

  return (
    <div className="max-w-5xl">
      <Encabezado titulo="Refacciones" sub="Alta con costo; al cliente se le presupuesta costo +15%." />
      {msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
      <section className="tarjeta mb-5 grid gap-4 p-5 sm:grid-cols-[1.4fr_1.4fr_0.8fr_auto] sm:items-end">
        <Campo etiqueta="Orden">
          <select className="campo" value={ordenId} onChange={(e) => setOrdenId(e.target.value)}>
            <option value="">Elegí…</option>
            {(ordenes.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.folio} · {o.placa}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Refacción"><input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Faro delantero" /></Campo>
        <Campo etiqueta="Costo (MXN)"><input className="campo font-mono" type="number" min="0.01" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
        <Boton variante="primario" onClick={alta} cargando={ocupado === 'alta'} disabled={!ordenId || !nombre || !costo}>Dar de alta</Boton>
      </section>
      <label className="mb-3 flex items-center gap-2 text-sm text-grafito-600"><input type="checkbox" checked={soloPend} onChange={(e) => setSoloPend(e.target.checked)} /> Solo sin recibir</label>
      {lista.cargando && !lista.data ? <Cargando /> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[700px]">
            <thead><tr><th>Orden</th><th>Refacción</th>{ger && <th className="text-right">Costo</th>}<th className="text-right">Precio</th>{ger && <th className="text-right">Margen</th>}<th>Estado</th><th></th></tr></thead>
            <tbody>
              {filas.map((r) => (
                <tr key={r.id}>
                  <td><Link className="folio hover:underline" to={`/ordenes/${r.orden_id}`}>{r.folio}</Link> <span className="font-mono text-xs text-grafito-500">{r.placa}</span></td>
                  <td>{r.nombre}</td>
                  {ger && <td className="text-right font-mono text-grafito-600">{dinero(r.costo)}</td>}
                  <td className="text-right font-mono">{dinero(r.precio_venta)}</td>
                  {ger && <td className="text-right font-mono text-grafito-600">{dinero(r.margen)}</td>}
                  <td><Estado valor={r.estado} refaccion />{r.recibida_en && <span className="ml-2 text-xs text-grafito-400">{fechaHora(r.recibida_en)}</span>}</td>
                  <td className="text-right">{r.estado !== 'Recibida' && <Boton onClick={() => recibir(r.id)} cargando={ocupado === r.id}>Marcar Recibida</Boton>}</td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-grafito-400">Sin refacciones.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
