import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '@/lib/op';
import { useCarga } from '@/lib/useCarga';
import { dinero, etiquetaDia, fechaHora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Atrasada, Aviso, Boton, Cargando, Encabezado, Kpi } from '@/components/ui';

export default function Panel() {
  const [lunes, setLunes] = useState(lunesDe());
  const { data: d, cargando, error, recargar } = useCarga(() => rpc<any>('panel_gerencia', { p_semana: lunes }), [lunes]);
  const maxH = Math.max(1, ...(d?.horas_programadas ?? []).map((x: any) => Number(x.horas)));

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
            <Kpi etiqueta="Horas vendidas" valor={horas(d.horas_vendidas)} sub="Etapas terminadas en la semana" />
            <Kpi etiqueta="Venta mano de obra" valor={dinero(d.venta_mano_obra)} />
            <Kpi etiqueta="Costo técnicos" valor={dinero(d.costo_tecnicos)} sub="Pago base + bonos" />
            <Kpi etiqueta="Ganancia semanal" valor={dinero(d.ganancia)} sub={`MO − técnicos + margen refacciones (${dinero(d.margen_refacciones)})`} />
            <Kpi etiqueta="Atrasos" valor={d.atrasos.length} alerta={d.atrasos.length > 0} sub={`Cobrado en la semana: ${dinero(d.cobrado)}`} />
          </div>

          <section className="tarjeta overflow-x-auto">
            <h2 className="etiqueta border-b border-grafito-700 px-4 py-3 text-sm">Órdenes atrasadas</h2>
            {d.atrasos.length === 0 ? <p className="p-4 text-sm text-grafito-400">Sin atrasos. La última etapa de cada orden termina antes de su fecha prometida.</p> : (
              <table className="tabla min-w-[640px]">
                <thead><tr><th>Folio</th><th>Placa</th><th>Cliente</th><th>Etapa actual</th><th>Prometida</th><th>Fin programado</th><th></th></tr></thead>
                <tbody>
                  {d.atrasos.map((o: any) => (
                    <tr key={o.id}>
                      <td><Link to={`/ordenes/${o.id}`} className="folio hover:underline">{o.folio}</Link></td>
                      <td className="font-mono">{o.placa}</td><td>{o.cliente}</td><td>{o.etapa_actual ?? '—'}</td>
                      <td>{fechaHora(o.fecha_prometida)}</td>
                      <td className="font-semibold text-alerta">{o.fin_programado ? fechaHora(o.fin_programado) : 'sin programar'}</td>
                      <td><Atrasada /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="tarjeta p-4">
              <h2 className="etiqueta text-sm">Horas programadas por área</h2>
              <ul className="mt-3 space-y-2">
                {d.horas_programadas.map((a: any) => (
                  <li key={a.area} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 text-sm">
                    <span className="truncate">{a.area}</span>
                    <span className="h-3 rounded-sm bg-grafito-800"><span className="block h-3 rounded-sm" style={{ width: `${(Number(a.horas) / maxH) * 100}%`, background: a.color }} /></span>
                    <span className="text-right font-mono text-grafito-300">{horas(a.horas)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="tarjeta overflow-x-auto">
              <h2 className="etiqueta border-b border-grafito-700 px-4 py-3 text-sm">Técnicos</h2>
              <table className="tabla">
                <thead><tr><th>Técnico</th><th className="text-right">Vendidas</th><th className="text-right">Productivas</th><th className="text-right">Bono</th></tr></thead>
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
