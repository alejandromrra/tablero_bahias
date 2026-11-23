import { useState } from 'react';
import { nuevoOpId, operar, rpc } from '@/lib/op';
import { useCarga } from '@/lib/useCarga';
import { dinero, etiquetaDia, fechaHora, horas, lunesDe, sumarDias } from '@/lib/format';
import { Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';

export default function Liquidacion() {
  const [lunes, setLunes] = useState(lunesDe());
  const [opId, setOpId] = useState(nuevoOpId);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const { data, cargando, error, recargar } = useCarga(() => rpc<any>('liquidacion_semana', { p_semana: lunes }), [lunes]);

  const cerrada = data?.estado === 'Cerrada';
  const filas: any[] = data?.filas ?? [];
  const tot = filas.reduce((a, f) => ({ v: a.v + Number(f.horas_vendidas), p: a.p + Number(f.horas_productivas), b: a.b + Number(f.bono), t: a.t + Number(f.total) }), { v: 0, p: 0, b: 0, t: 0 });

  const cerrar = async () => {
    if (!confirm(`¿Cerrar la liquidación de la semana del ${etiquetaDia(lunes)}? Queda en solo lectura y bloquea cambios en esa semana.`)) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await operar<any>('cerrar_liquidacion', { semana_inicio: lunes }, opId);
      setMsg({ tipo: 'ok', texto: r.repetida ? 'La liquidación ya estaba cerrada con esta operación.' : `Liquidación cerrada · total ${dinero(r.total_pagar)}.` });
      setOpId(nuevoOpId());
      recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setEnviando(false); }
  };

  return (
    <div className="max-w-5xl">
      <Encabezado titulo="Liquidación semanal" sub={`Semana del ${etiquetaDia(lunes)} al ${etiquetaDia(sumarDias(lunes, 6))}`}>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, -7))}>◀</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(lunesDe())}>Esta semana</Boton>
        <Boton variante="fantasma" onClick={() => setLunes(sumarDias(lunes, 7))} disabled={lunes >= lunesDe()}>▶</Boton>
        {data && <Estado valor={data.estado} />}
        <Boton variante="primario" onClick={cerrar} cargando={enviando} disabled={cerrada || !data}>Cerrar liquidación</Boton>
      </Encabezado>
      {msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
      {cerrada && <div className="mb-4"><Aviso tipo="info">Cerrada {fechaHora(data.cerrada_en)} · solo lectura. Los bloques y avances de esta semana ya no se pueden modificar.</Aviso></div>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {cargando && !data ? <Cargando /> : data && (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[760px]">
            <thead><tr><th>Técnico</th><th className="text-right">Horas vendidas</th><th className="text-right">Horas productivas</th><th className="text-right">Eficiencia</th><th className="text-right">Tarifa</th><th className="text-right">Pago base</th><th className="text-right">Bono</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.tecnico_id}>
                  <td className="font-semibold">{f.tecnico_nombre}</td>
                  <td className="text-right font-mono">{horas(f.horas_vendidas)}</td>
                  <td className="text-right font-mono">{horas(f.horas_productivas)}</td>
                  <td className="text-right font-mono text-grafito-600">{Number(f.horas_productivas) > 0 ? `${Math.round((f.horas_vendidas / f.horas_productivas) * 100)}%` : '—'}</td>
                  <td className="text-right font-mono text-grafito-600">{dinero(f.tarifa_hora)}</td>
                  <td className="text-right font-mono">{dinero(f.pago_base)}</td>
                  <td className="text-right font-mono">{dinero(f.bono)}</td>
                  <td className="text-right font-mono font-semibold">{dinero(f.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 text-right font-mono">{horas(tot.v)}</td><td className="px-3 text-right font-mono">{horas(tot.p)}</td><td /><td /><td /><td className="px-3 text-right font-mono">{dinero(tot.b)}</td><td className="px-3 text-right font-mono">{dinero(tot.t)}</td></tr>
            </tfoot>
          </table>
          <p className="px-3 py-3 text-xs text-grafito-500">
            Horas vendidas: horas de catálogo de las etapas que el técnico terminó en la semana. Productivas: tiempo real marcado «En curso».
            Pago base = horas productivas × tarifa. Bono: {dinero(data.bono_hora)} por cada hora productiva por encima de {Number(data.umbral_bono_horas)} h.
          </p>
        </div>
      )}
    </div>
  );
}
