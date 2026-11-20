import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { q, useCarga } from '@/lib/useCarga';
import { fechaHora } from '@/lib/format';
import { Atrasada, Aviso, Boton, Cargando, Encabezado, Estado } from '@/components/ui';

const ESTADOS = ['Presupuesto', 'En proceso', 'Esperando refacciones', 'Terminada', 'Entregada'];

export default function Ordenes() {
  const nav = useNavigate();
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('');
  const [soloAtrasadas, setSoloAtrasadas] = useState(false);
  const { data, error, cargando, recargar } = useCarga(() =>
    q<any[]>(supabase.from('v_orden_lista').select('*').order('fecha_prometida')), []);

  const t = texto.trim().toLowerCase();
  const filas = (data ?? []).filter((o) =>
    (!t || [o.folio, o.placa, o.cliente].some((v) => String(v ?? '').toLowerCase().includes(t))) &&
    (!estado || o.estado === estado) && (!soloAtrasadas || o.atrasada));

  return (
    <div>
      <Encabezado titulo="Órdenes" sub={`${data?.length ?? 0} órdenes · ${(data ?? []).filter((o) => o.atrasada).length} atrasadas`}>
        <Boton onClick={recargar}>Actualizar</Boton>
        <Boton variante="primario" onClick={() => nav('/ordenes/nueva')}>+ Nueva orden</Boton>
      </Encabezado>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="campo max-w-xs" placeholder="Buscar folio, placa o cliente" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="campo max-w-[14rem]" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-grafito-300"><input type="checkbox" checked={soloAtrasadas} onChange={(e) => setSoloAtrasadas(e.target.checked)} /> Solo atrasadas</label>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {cargando && !data ? <Cargando /> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[760px]">
            <thead><tr><th>Folio</th><th>Placa</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Etapa actual</th><th>Fecha prometida</th><th></th></tr></thead>
            <tbody>
              {filas.map((o) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ordenes/${o.id}`)}>
                  <td><Link to={`/ordenes/${o.id}`} className="folio text-tiza hover:underline">{o.folio}</Link></td>
                  <td className="font-mono">{o.placa}</td>
                  <td>{o.cliente}</td>
                  <td className="text-grafito-300">{o.tipo}{o.aseguradora ? ` · ${o.aseguradora}` : ''}</td>
                  <td><Estado valor={o.estado} /></td>
                  <td className="text-grafito-300">{o.etapa_actual ?? '—'}</td>
                  <td className={o.atrasada ? 'font-semibold text-alerta' : ''}>{fechaHora(o.fecha_prometida)}</td>
                  <td>{o.atrasada && <Atrasada />}</td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-grafito-400">Sin órdenes con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
