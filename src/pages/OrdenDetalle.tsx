import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { dinero, fecha, fechaHora, hora, horas } from '@/lib/format';
import { descargar, generarIcs } from '@/lib/ics';
import { Atrasada, Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';
import { nombreEtapa } from '@/pages/Planificador';

export default function OrdenDetalle() {
  const { id } = useParams();
  const [copiado, setCopiado] = useState(false);
  const { data, error, cargando, recargar } = useCarga(async () => {
    const [orden, piezas, etapas, bloques, areas, fin] = await Promise.all([
      q<any>(supabase.from('v_orden_lista').select('*').eq('id', id!).maybeSingle()),
      q<any[]>(supabase.from('pieza').select('id, nombre, dano').eq('orden_id', id!)),
      q<any[]>(supabase.from('etapa').select('id, tipo, secuencia, carga, horas, piezas, estado, especialidad, iniciada_en, terminada_en').eq('orden_id', id!).order('secuencia').order('carga')),
      q<any[]>(supabase.from('v_planificador').select('*').eq('orden_id', id!)),
      q<any[]>(supabase.from('area').select('id, nombre, color')),
      rpc<any>('orden_finanzas', { p_orden: id }),
    ]);
    return { orden, piezas, etapas, bloques, areas, fin };
  }, [id]);

  if (cargando && !data) return <Cargando />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!data?.orden) return <Aviso tipo="error">La orden no existe o no tenés acceso.</Aviso>;
  const { orden: o, piezas, etapas, bloques, areas, fin } = data;
  const bloquePorEtapa = Object.fromEntries(bloques.map((b) => [b.etapa_id, b]));
  const area = (aid: string) => areas.find((a) => a.id === aid);
  const urlConsulta = `${window.location.origin}/consulta?folio=${encodeURIComponent(o.folio)}&placa=${encodeURIComponent(o.placa)}`;
  const saldo = fin?.saldo_cliente ?? 0;

  const texto = [
    `Hola ${o.cliente ?? ''}, te escribimos del taller por tu vehículo ${o.placa} (orden ${o.folio}).`,
    `Etapa actual: ${o.etapa_actual ?? 'lista para entrega'} · Estado: ${o.estado}.`,
    `Fecha prometida: ${fechaHora(o.fecha_prometida)}.`,
    `Saldo a tu cargo: ${dinero(saldo)}.`,
    `Seguimiento: ${urlConsulta}`,
  ].join('\n');

  const whatsapp = () => {
    const tel = String(o.cliente_telefono ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };
  const ics = () => {
    const eventos = bloques.map((b) => ({
      uid: b.id, inicio: b.inicio, fin: b.fin,
      titulo: `${o.folio} · ${b.etapa_nombre} · ${o.placa}`,
      descripcion: `${b.tecnico ?? ''} en ${area(b.area_id)?.nombre ?? ''}`,
    }));
    const p = new Date(o.fecha_prometida);
    eventos.push({ uid: `${o.id}-entrega`, inicio: p.toISOString(), fin: new Date(p.getTime() + 30 * 60000).toISOString(), titulo: `Entrega prometida ${o.folio} · ${o.placa}`, descripcion: urlConsulta });
    descargar(`${o.folio}.ics`, generarIcs(eventos));
  };
  const copiar = async () => {
    await navigator.clipboard.writeText(texto);
    setCopiado(true); setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="max-w-5xl">
      <Encabezado titulo={`Orden ${o.folio}`} sub={<span className="font-mono">{o.placa} · {o.cliente} · {o.tipo}{o.aseguradora ? ` (${o.aseguradora})` : ''}</span>}>
        <Boton onClick={whatsapp}>Compartir por WhatsApp</Boton>
        <Boton onClick={ics}>Descargar .ics</Boton>
        <Boton onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar texto'}</Boton>
      </Encabezado>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Estado valor={o.estado} />
        {o.atrasada && <Atrasada />}
        <span className={`text-sm ${o.atrasada ? 'font-semibold text-alerta' : 'text-grafito-300'}`}>
          Prometida {fechaHora(o.fecha_prometida)}{o.fin_programado ? ` · última etapa termina ${fechaHora(o.fin_programado)}` : ''}
        </span>
        <span className="flex-1" />
        <Link to={`/ordenes/${o.id}/presupuesto`} className="font-cond text-sm font-semibold uppercase tracking-wide text-tiza underline underline-offset-4">Presupuesto</Link>
        <Link to={`/pagos?orden=${o.id}`} className="font-cond text-sm font-semibold uppercase tracking-wide text-tiza underline underline-offset-4">Pagos</Link>
        <Link to={`/refacciones?orden=${o.id}`} className="font-cond text-sm font-semibold uppercase tracking-wide text-tiza underline underline-offset-4">Refacciones</Link>
      </div>

      {fin && !fin.autorizada_para_programar && (
        <div className="mb-4">
          <Aviso tipo="info">
            Todavía no se puede programar: {o.tipo === 'Particular'
              ? <>falta el anticipo del 50% ({dinero(fin.presupuesto.anticipo)}; pagado {dinero(fin.pagado)}).</>
              : <>el presupuesto de la aseguradora no está Autorizado.</>}
          </Aviso>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section className="tarjeta overflow-hidden">
          <h2 className="etiqueta border-b border-grafito-700 px-4 py-3 text-sm">Etapas en secuencia</h2>
          <ol>
            {etapas.map((e, i) => {
              const b = bloquePorEtapa[e.id];
              const a = b && area(b.area_id);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-3 border-b border-grafito-800 px-4 py-3 last:border-b-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-grafito-600 font-mono text-xs">{i + 1}</span>
                  <div className="min-w-[10rem] flex-1">
                    <div className="font-cond text-base font-semibold uppercase tracking-wide">
                      {nombreEtapa(e.tipo)}{e.tipo === 'pintura' ? ` · carga ${e.carga} (${e.piezas} pzas)` : ''}
                    </div>
                    <div className="text-xs text-grafito-400">{horas(e.horas)} · especialidad {e.especialidad}</div>
                  </div>
                  <div className="text-right text-xs text-grafito-300">
                    {b ? (
                      <>
                        <div className="flex items-center justify-end gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: a?.color }} />{a?.nombre} · {b.tecnico}</div>
                        <div className="font-mono">{b.folio} · {fechaHora(b.inicio)}–{hora(b.fin)}</div>
                      </>
                    ) : <span className="text-grafito-500">Sin programar</span>}
                  </div>
                  <Estado valor={e.estado} />
                </li>
              );
            })}
          </ol>
        </section>

        <div className="space-y-5">
          <section className="tarjeta p-4">
            <h2 className="etiqueta text-sm">Piezas</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {piezas.map((p) => <li key={p.id} className="flex justify-between"><span>{p.nombre}</span><span className="text-grafito-400">{p.dano}</span></li>)}
            </ul>
          </section>
          <section className="tarjeta p-4">
            <h2 className="etiqueta text-sm">Refacciones</h2>
            {(fin?.refacciones ?? []).length === 0 && <p className="mt-2 text-sm text-grafito-500">Sin refacciones.</p>}
            <ul className="mt-2 space-y-2 text-sm">
              {(fin?.refacciones ?? []).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.nombre}</span><Estado valor={r.estado} /></li>
              ))}
            </ul>
            {(fin?.refacciones ?? []).some((r: any) => r.estado !== 'Recibida') && <p className="mt-2 text-xs text-violet-300">El armado queda bloqueado hasta recibir todas.</p>}
          </section>
          {fin && (
            <section className="tarjeta p-4 text-sm">
              <h2 className="etiqueta text-sm">Dinero</h2>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between"><dt>Total</dt><dd className="font-mono">{dinero(fin.presupuesto.total)}</dd></div>
                <div className="flex justify-between"><dt>Pagado</dt><dd className="font-mono">{dinero(fin.pagado)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Saldo cliente</dt><dd className="font-mono">{dinero(fin.saldo_cliente)}</dd></div>
                {o.tipo === 'Aseguradora' && <div className="flex justify-between"><dt>Saldo aseguradora</dt><dd className="font-mono">{dinero(fin.saldo_aseguradora)}</dd></div>}
              </dl>
            </section>
          )}
          <p className="text-xs text-grafito-500">Creada {fecha(o.creado_en)} · <button className="underline" onClick={recargar}>actualizar</button></p>
        </div>
      </div>
    </div>
  );
}
