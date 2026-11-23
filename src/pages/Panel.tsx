import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '@/lib/op';
import { useCarga } from '@/lib/useCarga';
import { dinero, etiquetaDia, fechaHora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Atrasada, Aviso, Boton, Cargando, Encabezado, Kpi } from '@/components/ui';

export default function Panel() {
  const [lunes, setLunes] = useState(lunesDe());
  const { data: d, cargando, error, recargar } = useCarga(() => rpc<any>('panel_gerencia', { p_semana: lunes }), [lunes]);
  
  return (
    <div>
      <Encabezado titulo="Panel de gerencia" sub={`Semana del ${etiquetaDia(lunes)}`}>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, -7))}>◀</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(lunesDe())}>Esta semana</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, 7))}>▶</Boton>
        <Boton onClick={recargar}>Actualizar</Boton>
      </Encabezado>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {cargando && !d ? <Cargando /> : d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi etiqueta="Horas vendidas" valor={horas(d.horas_vendidas)} sub={`Etapas terminadas · ${dinero(d.venta_mano_obra)} de mano de obra`} />
            <Kpi etiqueta="Ganancia de la semana" valor={dinero(d.ganancia)} sub={`Margen de ${d.ordenes_listas.length} orden(es) listas para entrega`} />
            <Kpi etiqueta="Pago a técnicos" valor={dinero(d.costo_tecnicos)} sub="Horas productivas × tarifa + bonos" />
            <Kpi etiqueta="Cobrado" valor={dinero(d.cobrado)} sub="Pagos registrados en la semana" />
            <Kpi etiqueta="Atrasos" valor={d.atrasos.length} alerta={d.atrasos.length > 0} sub="Última etapa después de la fecha prometida" />
          </div>

          <section className="tarjeta overflow-x-auto">
            <h2 className="etiqueta border-b border-grafito-200 px-4 py-3 text-sm">Órdenes atrasadas</h2>
            {d.atrasos.length === 0 ? <p className="p-4 text-sm text-grafito-500">Sin atrasos. La última etapa de cada orden termina antes de su fecha prometida.</p> : (
              <table className="tabla min-w-[640px]">
                <thead><tr><th>Folio</th><th>Placa</th><th>Cliente</th><th>Etapa actual</th><th>Prometida</th><th>Fin programado</th><th></th></tr></thead>
                <tbody>
                  {d.atrasos.map((o: any) => (
                    <tr key={o.id}>
                      <td><Link to={`/ordenes/${o.id}`} className="folio hover:underline">{o.folio}</Link></td>
                      <td className="font-mono">{o.placa}</td><td>{o.cliente}</td><td>{o.etapa_actual ?? '—'}</td>
                      <td>{fechaHora(o.fecha_prometida)}</td>
                      <td className="font-semibold text-alerta-claro">{o.fin_programado ? fechaHora(o.fin_programado) : 'sin programar'}</td>
                      <td><Atrasada /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {d.ordenes_listas.length > 0 && (
            <section className="tarjeta overflow-x-auto">
              <h2 className="etiqueta border-b border-grafito-200 px-4 py-3 text-sm">Órdenes que quedaron listas esta semana</h2>
              <table className="tabla">
                <thead><tr><th>Folio</th><th>Placa</th><th className="text-right">Subtotal</th><th className="text-right">Margen</th></tr></thead>
                <tbody>{d.ordenes_listas.map((o: any) => (
                  <tr key={o.id}><td><Link to={`/ordenes/${o.id}`} className="folio hover:underline">{o.folio}</Link></td><td className="font-mono">{o.placa}</td>
                    <td className="text-right font-mono">{dinero(o.subtotal)}</td><td className="text-right font-mono font-semibold">{dinero(o.margen)}</td></tr>
                ))}</tbody>
              </table>
              <p className="px-3 py-2 text-xs text-grafito-500">Margen = subtotal − costo de horas reales de los técnicos − materiales − costo de refacciones.</p>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="tarjeta p-4">
              <h2 className="etiqueta text-sm">Ocupación por área (horas programadas / capacidad de la semana)</h2>
              <ul className="mt-3 space-y-2">
                {d.horas_programadas.map((a: any) => (
                  <li key={a.area} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm">
                    <span className="truncate">{a.area}</span>
                    <span className="h-3 rounded-sm bg-grafito-100"><span className="block h-3 rounded-sm" style={{ width: `${Math.min(100, (Number(a.horas) / Math.max(1, Number(a.capacidad_horas))) * 100)}%`, background: a.color }} /></span>
                    <span className="text-right font-mono text-grafito-600" title={`de ${horas(a.capacidad_horas)} disponibles`}>{Math.round((Number(a.horas) / Math.max(1, Number(a.capacidad_horas))) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="tarjeta overflow-x-auto">
              <h2 className="etiqueta border-b border-grafito-200 px-4 py-3 text-sm">Técnicos</h2>
              <table className="tabla">
                <thead><tr><th>Técnico</th><th className="text-right">Vendidas</th><th className="text-right">Productivas</th><th className="text-right">Bono (&gt;30 h prod.)</th></tr></thead>
                <tbody>
                  {d.tecnicos.map((t: any) => (
                    <tr key={t.tecnico_id}><td>{t.tecnico_nombre}</td><td className="text-right font-mono">{horas(t.horas_vendidas)}</td>
                      <td className="text-right font-mono">{horas(t.horas_productivas)}</td><td className="text-right font-mono">{dinero(t.bono)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
