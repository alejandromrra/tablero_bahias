import { useCallback, useEffect, useState } from 'react';

/** Carga asíncrona con estado de error y recarga manual */
export function useCarga<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    setCargando(true);
    try { setData(await fn()); setError(null); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setCargando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { data, error, cargando, recargar, setData };
}

/** Desempaqueta respuestas de supabase-js */
export async function q<T = any>(p: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}
