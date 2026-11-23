import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { operar, rpc } from '@/lib/op';
import { q, useCarga } from '@/lib/useCarga';
import { dinero, fecha, fechaHora, hora, horas } from '@/lib/format';
import { descargar, generarIcs } from '@/lib/ics';
import { Atrasada, Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';
import { nombreEtapa } from '@/pages/Planificador';

export default function OrdenDetalle() {
  const { id } = useParams();
  const [copiado, setCopiado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { data, error, cargando, recargar } = useCarga(async () => {
    const [orden, piezas, etapas, bloques, areas, fin] = await Promise.all([
      q<any>(supabase.from('v_orden_lista').select('*').eq('id', id!).maybeSingle()),
      q<any[]>(supabase.from('pieza').select('id, nombre, dano').eq('orden_id', id!)),
      q<any[]>(supabase.from('etapa').select('id, tipo, secuencia, carga, horas, piezas, estado, especialidades, programable, iniciada_en, terminada_en').eq('orden_id', id!).order('secuencia').order('carga')),
      q<any[]>(supabase.from('v_planificador').select('*').eq('orden_id', id!).order('inicio')),
      q<any[]>(supabase.from('area').select('id, nombre, color')),
      rpc<any>('orden_finanzas', { p_orden: id }),
    ]);
    return { orden, piezas, etapas, bloques, areas, fin };
  }, [id]);

  if (cargando && !data) return <Cargando />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!data?.orden) return <Aviso tipo="error">La orden no existe o no tenés acceso.</Aviso>;
  const { orden: o, piezas, etapas, bloques, areas, fin } = data;
  const tramosDe = (etapaId: string) => bloques.filter((b) => b.etapa_id === etapaId);
  const area = (aid: string) => areas.find((a) => a.id === aid);
  const urlConsulta = `${window.location.origin}${import.meta.env.BASE_URL}consulta?folio=${encodeURIComponent(o.folio)}&placa=${encodeURIComponent(o.placa)}`;
  const saldo = fin?.saldo_cliente ?? 0;
  const pulido = etapas.find((e) => e.tipo === 'pulido_armado');
  const qc = etapas.find((e) => e.tipo === 'control_calidad');
  const presu = fin?.presupuesto?.estado;

  const accion = async (tipo: string, texto: string, confirmar?: string) => {
    if (confirmar && !confirm(confirmar)) return;
    setOcupado(tipo); setMsg(null);
    try {
      const r = await operar<any>(tipo, { orden_id: o.id });
      setMsg({ tipo: 'ok', texto: tipo === 'cancelar_orden' ? `Orden cancelada. Bloques liberados: ${(r.liberados ?? []).join(', ') || 'ninguno'}.` : texto });
      recargar();
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }); }
    finally { setOcupado(null); }
  };

  const texto = [
    `Hola ${o.cliente ?? ''}, te escribimos del taller por tu vehículo ${o.placa} (orden ${o.folio}).`,
    `Estado: ${o.estado}${o.etapa_actual && o.estado === 'En proceso' ? ` · etapa ${o.etapa_actual}` : ''}.`,
    `Fecha prometida: ${fechaHora(o.fecha_prometida)}.`,
    `Saldo a tu cargo: ${dinero(saldo)}.`,
    `Seguimiento con tu folio y placa: ${urlConsulta}`,
  ].join('\n');

  const whatsapp = () => {
    const tel = String(o.cliente_telefono ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };
  const ics = () => {
    const p = new Date(o.fecha_prometida);
    descargar(`${o.folio}.ics`, generarIcs([{
      uid: `${o.id}-entrega`, inicio: p.toISOString(), fin: new Date(p.getTime() + 30 * 60000).toISOString(),
      titulo: `Entrega de tu vehículo ${o.placa} (${o.folio})`, descripcion: `${texto}`,
    }]));
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { setMsg({ tipo: 'error', texto: 'No se pudo copiar: seleccioná el texto a mano.' }); }
  };

  return (
    <div className="max-w-5xl">
      <Encabezado titulo={`Orden ${o.folio}`} sub={<span className="font-mono">{o.placa} · {o.cliente} · {o.tipo}{o.aseguradora ? ` (${o.aseguradora})` : ''}</span>}>
        <Boton onClick={whatsapp}>Compartir por WhatsApp</Boton>
        <Boton onClick={ics}>Descargar .ics</Boton>
        <Boton onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar texto'}</Boton>
      </Encabezado>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Estado valor={o.estado} />
        {o.atrasada && <Atrasada />}
        <span className={`text-sm ${o.atrasada ? 'font-semibold text-alerta-claro' : 'text-grafito-600'}`}>
          Prometida {fechaHora(o.fecha_prometida)}{o.fin_programado ? ` · última etapa termina ${fechaHora(o.fin_programado)}` : ''}
        </span>
        <span className="flex-1" />
        <Link to={`/ordenes/${o.id}/presupuesto`} className="font-cond text-sm font-semibold uppercase tracking-wide underline underline-offset-4">Presupuesto</Link>
        <Link to={`/pagos?orden=${o.id}`} className="font-cond text-sm font-semibold uppercase tracking-wide underline underline-offset-4">Pagos</Link>
        <Link to={`/refacciones?orden=${o.id}`} className="font-cond text-sm font-semibold uppercase tracking-wide underline underline-offset-4">Refacciones</Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {presu === 'Borrador' && <Boton variante="primario" cargando={ocupado === 'emitir_presupuesto'} onClick={() => accion('emitir_presupuesto', 'Presupuesto emitido.')}>Emitir presupuesto</Boton>}
        {presu === 'Emitido' && <Boton variante="primario" cargando={ocupado === 'autorizar_presupuesto'} onClick={() => accion('autorizar_presupuesto', 'Presupuesto autorizado.')}>Marcar autorizado</Boton>}
        {qc && qc.estado !== 'Terminada' && pulido?.estado === 'Terminada' && o.estado !== 'Cancelada' &&
          <Boton variante="primario" cargando={ocupado === 'control_calidad'} onClick={() => accion('control_calidad', 'Control de calidad hecho: lista para entrega.')}>Control de calidad OK</Boton>}
        {o.estado === 'Lista para entrega' && <Boton variante="primario" cargando={ocupado === 'entregar_orden'} onClick={() => accion('entregar_orden', 'Vehículo entregado.')}>Entregar</Boton>}
        {!['Entregada', 'Cancelada'].includes(o.estado) &&
          <Boton cargando={ocupado === 'cancelar_orden'} onClick={() => accion('cancelar_orden', '', `¿Cancelar ${o.folio}? Se liberan todos sus bloques futuros.`)}>Cancelar orden</Boton>}
      </div>
      {msg && <div className="mb-4"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}

      {fin && !fin.habilitada && !['Cancelada', 'Entregada', 'Lista para entrega'].includes(o.estado) && (
        <div className="mb-4">
          <Aviso tipo="info">
            Todavía no se programa: {o.tipo === 'Particular'
              ? <>falta el 50% de anticipo ({dinero(fin.presupuesto.anticipo)}; pagado {dinero(fin.pagado)}).</>
              : <>la aseguradora todavía no autorizó el presupuesto.</>}
          </Aviso>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section className="tarjeta overflow-hidden">
          <h2 className="etiqueta border-b border-grafito-200 px-4 py-3 text-sm">Etapas en secuencia</h2>
          <ol>
            {etapas.map((e, i) => {
              const tr = tramosDe(e.id);
              const a = tr[0] && area(tr[0].area_id);
              return (
                <li key={e.id}>
                  {e.tipo === 'pulido_armado' && o.curado_hasta && (
                    <div className="flex items-center gap-3 border-b border-grafito-100 bg-grafito-50 px-4 py-2 text-sm text-grafito-600">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-grafito-400 text-xs">⏱</span>
                      <span className="flex-1">Curado de pintura · 12 h calendario, corre aunque el taller esté cerrado</span>
                      <span className="text-xs">hasta {fechaHora(o.curado_hasta)}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 border-b border-grafito-100 px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-grafito-300 font-mono text-xs">{i + 1}</span>
                    <div className="min-w-[10rem] flex-1">
                      <div className="font-cond text-base font-semibold uppercase tracking-wide">
                        {nombreEtapa(e.tipo)}{e.tipo === 'pintura' ? ` · carga ${e.carga} (${e.piezas} pzas)` : ''}
                      </div>
                      <div className="text-xs text-grafito-500">
                        {horas(e.horas)}{e.tipo === 'pintura' ? ' + 1 h de horneado' : ''}{e.especialidades.length ? ` · ${e.especialidades.join(' o ')}` : ' · lo marca gerencia o el asesor'}
                      </div>
                    </div>
                    <div className="text-right text-xs text-grafito-600">
                      {tr.length ? (
                        <>
                          <div className="flex items-center justify-end gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: a?.color }} />{a?.nombre} · {tr[0].tecnico}</div>
                          {tr.map((b) => <div key={b.id} className="font-mono">{b.folio} · {fechaHora(b.inicio)}–{hora(b.fin)}</div>)}
                        </>
                      ) : e.programable ? <span className="text-grafito-400">Sin programar</span> : e.terminada_en ? <span>{fechaHora(e.terminada_en)}</span> : <span className="text-grafito-400">Al final</span>}
                    </div>
                    <Estado valor={e.estado} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="space-y-5">
          <section className="tarjeta p-4">
            <h2 className="etiqueta text-sm">Piezas</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {piezas.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{p.nombre}</span><span className="text-grafito-500">{p.dano}</span></li>)}
            </ul>
          </section>
          <section className="tarjeta p-4">
            <h2 className="etiqueta text-sm">Refacciones</h2>
            {(fin?.refacciones ?? []).length === 0 && <p className="mt-2 text-sm text-grafito-400">Sin refacciones.</p>}
            <ul className="mt-2 space-y-2 text-sm">
              {(fin?.refacciones ?? []).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.nombre}</span><Estado valor={r.estado} refaccion /></li>
              ))}
            </ul>
            {(fin?.refacciones ?? []).some((r: any) => r.estado !== 'Recibida') && <p className="mt-2 text-xs text-violeta">Pulido y armado no se programa ni empieza hasta recibir todas.</p>}
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
          <p className="text-xs text-grafito-400">Creada {fecha(o.creado_en)} · <button className="underline" onClick={recargar}>actualizar</button></p>
        </div>
      </div>
    </div>
  );
}
