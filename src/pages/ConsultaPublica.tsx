import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { dinero, fechaHora } from '@/lib/format';
import { Aviso, Boton, Campo } from '@/components/ui';
import { Logo } from '@/components/Layout';

export default function ConsultaPublica() {
  const [params] = useSearchParams();
  const [folio, setFolio] = useState(params.get('folio') ?? '');
  const [placa, setPlaca] = useState(params.get('placa') ?? '');
  const [res, setRes] = useState<any | null | undefined>(undefined);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setCargando(true); setError(null);
    const { data, error } = await supabase.rpc('consulta_publica', { p_folio: folio, p_placa: placa });
    setCargando(false);
    if (error) setError(error.message); else setRes(data);
  };
  useEffect(() => { if (params.get('folio') && params.get('placa')) buscar(); }, []);

  return (
    <div className="flex min-h-full items-start justify-center p-4 pt-[8vh]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={buscar} className="tarjeta space-y-4 p-6">
          <h1 className="titulo text-xl">¿Cómo va mi vehículo?</h1>
          <p className="text-sm text-grafito-500">Ingresá el folio de tu orden y la placa, tal como figuran en tu comprobante.</p>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Folio"><input className="campo font-mono uppercase" placeholder="OT-0001" required value={folio} onChange={(e) => setFolio(e.target.value.toUpperCase())} /></Campo>
            <Campo etiqueta="Placa"><input className="campo font-mono uppercase" placeholder="ABC-123-D" required value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} /></Campo>
          </div>
          <Boton variante="primario" className="w-full" cargando={cargando}>Consultar</Boton>
        </form>
        <div className="mt-4">
          {error && <Aviso tipo="error">{error}</Aviso>}
          {res === null && <Aviso tipo="info">No encontramos una orden con ese folio y esa placa. Revisá los datos.</Aviso>}
          {res && (
            <div className="tarjeta space-y-3 p-6">
              <div className="flex items-center justify-between"><span className="font-mono text-xl font-bold">{folio.toUpperCase()}</span><span className="font-mono text-grafito-600">{placa.toUpperCase()}</span></div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-grafito-500">Etapa actual</dt><dd className="font-cond text-lg font-semibold uppercase">{res.etapa_actual ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-grafito-500">Fecha prometida</dt><dd className="">{fechaHora(res.fecha_prometida)}</dd></div>
                <div className="flex justify-between"><dt className="text-grafito-500">Saldo a tu cargo</dt><dd className="font-mono text-lg font-semibold">{dinero(res.saldo)}</dd></div>
              </dl>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-grafito-400"><Link to="/login" className="underline">Acceso del taller</Link></p>
      </div>
    </div>
  );
}
