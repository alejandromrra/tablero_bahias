import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { operar, rpc } from '@/lib/op';
import { useCarga } from '@/lib/useCarga';
import { useAuth } from '@/lib/auth';
import { dinero, fechaHora, horas } from '@/lib/format';
import { Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';

const pct = (n: number) => `${Math.round(Number(n) * 100)}%`;

function Fila({ t, v, fuerte, sub }: { t: string; v: number; fuerte?: boolean; sub?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${fuerte ? 'border-t border-grafito-300 pt-2 text-lg font-bold' : ''}`}>
      <span>{t}{sub && <span className="ml-2 text-xs font-normal text-grafito-500">{sub}</span>}</span>
      <span className="font-mono tabular-nums">{dinero(v)}</span>
    </div>
  );
}

export default function Presupuesto() {
  const { id } = useParams();
  const { perfil } = useAuth();
  const ger = perfil?.rol === 'gerencia';
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { data: f, cargando, error: errCarga, recargar } = useCarga(() => rpc<any>('orden_finanzas', { p_orden: id }), [id]);

  if (cargando && !f) return <Cargando />;
  if (errCarga) return <Aviso tipo="error">{errCarga}</Aviso>;
  if (!f) return <Aviso tipo="error">Sin acceso al presupuesto.</Aviso>;
  const p = f.presupuesto;
  const aseg = f.tipo === 'Aseguradora';

  const accion = async (tipo: string) => {
    setEnviando(true); setError(null);
    try { await operar(tipo, { orden_id: id }); await recargar(); }
    catch (e: any) { setError(e.message); }
    finally { setEnviando(false); }
  };

  return (
    <div className="max-w-5xl">
      <Encabezado titulo={`Presupuesto ${f.folio}`} sub={<>{f.tipo}{f.aseguradora ? ` · ${f.aseguradora}` : ''} · orden {f.estado_orden} · <Link className="underline" to={`/ordenes/${id}`}>ver orden</Link></>}>
        <Estado valor={p.estado} />
        {p.estado === 'Borrador' && <Boton variante="primario" onClick={() => accion('emitir_presupuesto')} cargando={enviando}>Emitir</Boton>}
        {p.estado === 'Emitido' && <Boton variante="primario" onClick={() => accion('autorizar_presupuesto')} cargando={enviando}>Marcar autorizado</Boton>}
        <Boton className="no-print" onClick={() => window.print()}>Imprimir</Boton>
      </Encabezado>
      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}
      {p.autorizado_en && <p className="mb-4 text-sm text-grafito-500">Autorizado {fechaHora(p.autorizado_en)}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <section className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Etapa</th><th className="text-right">Horas vendidas</th><th className="text-right">Mano de obra</th><th className="text-right">Materiales</th></tr></thead>
              <tbody>
                {f.lineas.map((l: any, i: number) => (
                  <tr key={i} className={l.vendible ? '' : 'text-grafito-400'}>
                    <td>{l.nombre}{l.tipo === 'pintura' ? ` (carga ${l.carga}, ${l.piezas} pzas; horneado no se cobra)` : ''}{!l.vendible ? ' (no se vende)' : ''}</td>
                    <td className="text-right font-mono">{l.vendible ? horas(l.horas) : '—'}</td>
                    <td className="text-right font-mono">{dinero(l.mano_obra)}</td>
                    <td className="text-right font-mono">{l.materiales ? dinero(l.materiales) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 text-right font-mono">{horas(p.horas_vendidas)}</td><td className="px-3 text-right font-mono">{dinero(p.mano_obra)}</td><td className="px-3 text-right font-mono">{dinero(p.materiales)}</td></tr></tfoot>
            </table>
            <p className="px-3 py-2 text-xs text-grafito-500">Mano de obra: horas vendidas × {dinero(f.tarifa_mo)}. Materiales: {dinero(f.material_pieza)} por pieza que pasa por pintura.</p>
          </section>
          <section className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Refacción</th><th>Estado</th>{ger && <th className="text-right">Costo</th>}<th className="text-right">Precio (costo +15%)</th></tr></thead>
              <tbody>
                {f.refacciones.map((r: any) => (
                  <tr key={r.id}><td>{r.nombre}</td><td><Estado valor={r.estado} refaccion /></td>
                    {ger && <td className="text-right font-mono text-grafito-600">{dinero(r.costo)}</td>}
                    <td className="text-right font-mono">{dinero(r.precio_venta)}</td></tr>
                ))}
                {f.refacciones.length === 0 && <tr><td colSpan={4} className="text-grafito-400">Sin refacciones.</td></tr>}
              </tbody>
            </table>
          </section>
          {ger && f.margen && (
            <section className="tarjeta p-5 text-sm">
              <h2 className="etiqueta text-sm">Margen (solo gerencia)</h2>
              <Fila t="Subtotal" v={p.subtotal} />
              <Fila t="− Costo de horas reales de técnicos" v={-f.margen.costo_horas_reales} />
              <Fila t="− Materiales" v={-f.margen.materiales} />
              <Fila t="− Costo de refacciones" v={-f.margen.costo_refacciones} />
              <Fila t="Margen" v={f.margen.margen} fuerte />
            </section>
          )}
        </div>

        <section className="tarjeta h-fit p-5 text-sm">
          <h2 className="etiqueta text-sm">Desglose</h2>
          <Fila t="Mano de obra" sub={horas(p.horas_vendidas)} v={p.mano_obra} />
          <Fila t="Materiales" v={p.materiales} />
          <Fila t="Refacciones" sub="costo +15%" v={p.refacciones} />
          <Fila t="Subtotal" v={p.subtotal} fuerte />
          <Fila t={`IVA ${pct(f.iva_pct)}`} v={p.iva} />
          <Fila t="Total" v={p.total} fuerte />
          <div className="mt-3 space-y-0.5 rounded-md bg-grafito-50 p-3">
            {aseg ? <>
              <Fila t="Deducible (paga el cliente)" v={f.deducible} />
              <Fila t="Saldo aseguradora" v={f.saldo_aseguradora} />
            </> : <Fila t={`Anticipo ${pct(f.anticipo_pct)}`} v={p.anticipo} />}
            <Fila t="Pagado" v={f.pagado} />
            <Fila t={aseg ? 'Saldo del cliente' : 'Saldo pendiente'} v={f.saldo_cliente} />
          </div>
          <p className="mt-3 text-xs text-grafito-500">
            {aseg ? 'Se programa cuando el presupuesto queda Autorizado.' : 'Se programa con el 50% de anticipo pagado.'}
            {' '}Hoy: {f.habilitada ? 'habilitada ✓' : 'todavía no'}.
          </p>
          <Link to={`/pagos?orden=${id}`} className="no-print mt-3 inline-block font-cond text-sm font-semibold uppercase tracking-wide underline underline-offset-4">Registrar pago →</Link>
        </section>
      </div>
    </div>
  );
}
