import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { nuevoOpId, operar, rpc } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { dinero, fechaHora } from '@/lib/format';
import { Aviso, Boton, Campo, Cargando, Encabezado } from '@/components/ui';

export default function Pagos() {
  const [params, setParams] = useSearchParams();
  const ordenId = params.get('orden') ?? '';
  const ordenes = useCarga(() => q<any[]>(supabase.from('v_orden_lista').select('id, folio, placa, cliente, tipo, estado').neq('estado', 'Cancelada').order('folio')), []);
  const fin = useCarga(async () => (ordenId ? rpc<any>('orden_finanzas', { p_orden: ordenId }) : null), [ordenId]);

  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('Anticipo');
  const [metodo, setMetodo] = useState('Efectivo');
  // op_id del intento: se renueva solo después de un pago confirmado,
  // así un doble clic o un reintento de red no cobra dos veces.
  const [opId, setOpId] = useState(nuevoOpId);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const f = fin.data;
  useEffect(() => {
    if (!f) return;
    if (f.tipo === 'Aseguradora') {
      setConcepto('Deducible');
      setMonto(String(Math.max(f.deducible - f.deducible_pagado, 0) || ''));
    } else {
      setConcepto(f.pagado < f.presupuesto.anticipo ? 'Anticipo' : 'Saldo');
      setMonto(String(f.pagado < f.presupuesto.anticipo ? (f.presupuesto.anticipo - f.pagado).toFixed(2) : f.saldo.toFixed(2)));
    }
  }, [f?.orden_id, f?.pagado]);

  const registrar = async () => {
    setEnviando(true); setMsg(null);
    try {
      const r = await operar<any>('registrar_pago', { orden_id: ordenId, monto: Number(monto), concepto, metodo }, opId);
      setMsg({ tipo: 'ok', texto: r.repetida ? 'Ese pago ya estaba registrado (operación repetida): no se cobró dos veces.' : `Pago registrado. Saldo: ${dinero(r.saldo)}${r.habilitada ? ' · la orden ya se puede programar' : ''}.` });
      setOpId(nuevoOpId());
      fin.recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setEnviando(false); }
  };

  const conceptos = f?.tipo === 'Aseguradora' ? ['Deducible', 'Aseguradora'] : ['Anticipo', 'Saldo'];

  return (
    <div className="max-w-4xl">
      <Encabezado titulo="Pagos" sub="Particular: anticipo del 50% y saldo. Aseguradora: el cliente paga el deducible y el resto lo cubre la aseguradora. Cada pago lleva un op_id: repetirlo no cobra dos veces." />
      <Campo etiqueta="Orden" className="mb-5 max-w-md">
        <select className="campo" value={ordenId} onChange={(e) => setParams(e.target.value ? { orden: e.target.value } : {})}>
          <option value="">Elegí una orden…</option>
          {(ordenes.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.folio} · {o.placa} · {o.cliente} · {o.tipo}</option>)}
        </select>
      </Campo>
      {fin.cargando && ordenId && !f && <Cargando />}
      {fin.error && <Aviso tipo="error">{fin.error}</Aviso>}
      {f && (
        <div className="grid gap-5 md:grid-cols-[1fr_20rem]">
          <section className="tarjeta p-5">
            {msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo etiqueta="Monto (MXN)"><input className="campo font-mono" type="number" min="0.01" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} /></Campo>
              <Campo etiqueta="Concepto">
                <select className="campo" value={concepto} onChange={(e) => setConcepto(e.target.value)}>{conceptos.map((c) => <option key={c}>{c}</option>)}</select>
              </Campo>
              <Campo etiqueta="Método">
                <select className="campo" value={metodo} onChange={(e) => setMetodo(e.target.value)}>{['Efectivo', 'Tarjeta', 'Transferencia'].map((c) => <option key={c}>{c}</option>)}</select>
              </Campo>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="font-mono text-[0.65rem] text-grafito-400">op_id {opId.slice(0, 8)}…</span>
              <Boton variante="primario" onClick={registrar} cargando={enviando} disabled={!monto}>Registrar pago</Boton>
            </div>
            <table className="tabla mt-6">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Método</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {f.pagos.map((g: any) => <tr key={g.id}><td>{fechaHora(g.creado_en)}</td><td>{g.concepto}</td><td>{g.metodo}</td><td className="text-right font-mono">{dinero(g.monto)}</td></tr>)}
                {f.pagos.length === 0 && <tr><td colSpan={4} className="text-grafito-400">Sin pagos todavía.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="tarjeta h-fit space-y-1.5 p-5 text-sm">
            <h2 className="etiqueta text-sm">{f.folio}</h2>
            <div className="flex justify-between"><span>Total</span><span className="font-mono">{dinero(f.presupuesto.total)}</span></div>
            {f.tipo === 'Aseguradora' ? <>
              <div className="flex justify-between"><span>Deducible</span><span className="font-mono">{dinero(f.deducible)}</span></div>
              <div className="flex justify-between"><span>Deducible pagado</span><span className="font-mono">{dinero(f.deducible_pagado)}</span></div>
              <div className="flex justify-between"><span>Saldo aseguradora</span><span className="font-mono">{dinero(f.saldo_aseguradora)}</span></div>
            </> : <div className="flex justify-between"><span>Anticipo requerido (50%)</span><span className="font-mono">{dinero(f.presupuesto.anticipo)}</span></div>}
            <div className="flex justify-between"><span>Pagado</span><span className="font-mono">{dinero(f.pagado)}</span></div>
            <div className="flex justify-between border-t border-grafito-200 pt-2 font-semibold"><span>Saldo</span><span className="font-mono">{dinero(f.saldo)}</span></div>
            <p className="pt-2 text-xs text-grafito-500">Programable: {f.habilitada ? 'sí ✓' : f.tipo === 'Aseguradora' ? 'no — falta autorización' : 'no — falta anticipo'}</p>
          </section>
        </div>
      )}
    </div>
  );
}
