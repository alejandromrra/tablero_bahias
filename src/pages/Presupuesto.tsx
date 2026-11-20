import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { operar, rpc } from '@/lib/op';
import { useCarga } from '@/lib/useCarga';
import { useAuth } from '@/lib/auth';
import { dinero, fechaHora, horas } from '@/lib/format';
import { Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';

const pct = (n: number) => `${Math.round(Number(n) * 100)}%`;

export default function Presupuesto() {
  const { id } = useParams();
  const { perfil } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { data: f, cargando, error: errCarga, recargar } = useCarga(() => rpc<any>('orden_finanzas', { p_orden: id }), [id]);

  if (cargando && !f) return <Cargando />;
  if (errCarga) return <Aviso tipo="error">{errCarga}</Aviso>;
  if (!f) return <Aviso tipo="error">Sin acceso al presupuesto.</Aviso>;
  const p = f.presupuesto;
  const aseg = f.tipo === 'Aseguradora';

  const autorizar = async () => {
    setEnviando(true); setError(null);
    try { await operar('autorizar_presupuesto', { orden_id: id }); await recargar(); }
    catch (e: any) { setError(e.message); }
    finally { setEnviando(false); }
  };

  const Fila = ({ t, v, fuerte, sub }: { t: string; v: number; fuerte?: boolean; sub?: string }) => (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${fuerte ? 'border-t border-grafito-600 pt-2 text-lg font-bold' : ''}`}>
      <span>{t}{sub && <span className="ml-2 text-xs font-normal text-grafito-400">{sub}</span>}</span>
      <span className="font-mono tabular-nums">{dinero(v)}</span>
    </div>
  );

  return (
    <div className="max-w-4xl">
      <Encabezado titulo={`Presupuesto ${f.folio}`} sub={<>{f.tipo}{f.aseguradora ? ` · ${f.aseguradora}` : ''} · <Link className="underline" to={`/ordenes/${id}`}>ver orden</Link></>}>
        <Estado valor={p.estado} />
        {aseg && p.estado !== 'Autorizado' && <Boton variante="primario" onClick={autorizar} cargando={enviando}>Marcar Autorizado</Boton>}
        <Boton className="no-print" onClick={() => window.print()}>Imprimir</Boton>
      </Encabezado>
      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}
      {p.autorizado_en && <p className="mb-4 text-sm text-grafito-400">Autorizado {fechaHora(p.autorizado_en)}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <section className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Etapa</th><th className="text-right">Horas</th><th className="text-right">Mano de obra</th><th className="text-right">Materiales</th></tr></thead>
              <tbody>
                {f.lineas.map((l: any, i: number) => (
                  <tr key={i}><td>{l.nombre}{l.tipo === 'pintura' ? ` (carga ${l.carga})` : ''}</td><td className="text-right font-mono">{horas(l.horas)}</td>
                    <td className="text-right font-mono">{dinero(l.mano_obra)}</td><td className="text-right font-mono">{dinero(l.materiales)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-grafito-400">Mano de obra a {dinero(f.tarifa_mo)} por hora.</p>
          </section>
          <section className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Refacción</th><th>Estado</th>{perfil?.rol === 'gerencia' && <th className="text-right">Costo</th>}<th className="text-right">Precio (costo +15%)</th></tr></thead>
              <tbody>
                {f.refacciones.map((r: any) => (
                  <tr key={r.id}><td>{r.nombre}</td><td><Estado valor={r.estado} /></td>
                    {perfil?.rol === 'gerencia' && <td className="text-right font-mono text-grafito-300">{dinero(r.costo)}</td>}
                    <td className="text-right font-mono">{dinero(r.precio_venta)}</td></tr>
                ))}
                {f.refacciones.length === 0 && <tr><td colSpan={4} className="text-grafito-500">Sin refacciones.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>

        <section className="tarjeta h-fit p-5 text-sm">
          <h2 className="etiqueta text-sm">Desglose</h2>
          <Fila t="Mano de obra" v={p.mano_obra} />
          <Fila t="Materiales" v={p.materiales} />
          <Fila t="Refacciones" sub="costo +15%" v={p.refacciones} />
          <Fila t="Subtotal" v={p.subtotal} fuerte />
          <Fila t={`IVA ${pct(f.iva_pct)}`} v={p.iva} />
          <Fila t="Total" v={p.total} fuerte />
          <div className="mt-3 space-y-0.5 rounded-md bg-grafito-900 p-3">
            {aseg ? <>
              <Fila t="Deducible (cliente)" v={f.deducible} />
              <Fila t="Saldo aseguradora" v={p.total - f.deducible} />
            </> : <Fila t={`Anticipo ${pct(f.anticipo_pct)}`} v={p.anticipo} />}
            <Fila t="Pagado" v={f.pagado} />
            <Fila t="Saldo pendiente" v={f.saldo} />
          </div>
          <p className="mt-3 text-xs text-grafito-400">
            {aseg ? 'Se puede programar cuando la aseguradora autoriza.' : 'Se puede programar con el 50% de anticipo pagado.'}
            {' '}Estado: {f.autorizada_para_programar ? 'habilitada ✓' : 'todavía no'}.
          </p>
          <Link to={`/pagos?orden=${id}`} className="no-print mt-3 inline-block font-cond text-sm font-semibold uppercase tracking-wide underline underline-offset-4">Registrar pago →</Link>
        </section>
      </div>
    </div>
  );
}
