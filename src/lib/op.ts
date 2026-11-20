import { supabase } from './supabase';

export class OpError extends Error {
  conflicto: boolean;
  detalle: any;
  code?: string;
  constructor(msg: string, opts: { conflicto?: boolean; detalle?: any; code?: string } = {}) {
    super(msg);
    this.conflicto = !!opts.conflicto;
    this.detalle = opts.detalle;
    this.code = opts.code;
  }
}

export const nuevoOpId = () => crypto.randomUUID();

const esErrorDeRed = (e: any) =>
  !e?.code && /fetch|network|timeout|load failed/i.test(String(e?.message ?? ''));

/**
 * Llama a public.operar() — única puerta de escritura, transaccional e idempotente.
 * Ante un corte de red reintenta con el MISMO op_id: si la primera llamada llegó a
 * confirmarse, la BD devuelve el resultado guardado y no escribe dos veces.
 */
export async function operar<T = any>(tipo: string, payload: Record<string, any>, opId: string = nuevoOpId()): Promise<T & { repetida: boolean }> {
  let ultimo: any;
  for (let intento = 0; intento < 3; intento++) {
    const { data, error } = await supabase.rpc('operar', { p_op_id: opId, p_tipo: tipo, p_payload: payload });
    if (!error) return data as any;
    ultimo = error;
    if (esErrorDeRed(error) && intento < 2) {
      await new Promise((r) => setTimeout(r, 600 * (intento + 1)));
      continue;
    }
    break;
  }
  let detalle: any;
  try { detalle = ultimo?.details ? JSON.parse(ultimo.details) : undefined; } catch { detalle = ultimo?.details; }
  throw new OpError(ultimo?.message ?? 'Error desconocido', {
    conflicto: ultimo?.code === 'PT409' || ultimo?.hint === 'CONFLICTO',
    detalle,
    code: ultimo?.code,
  });
}

export async function rpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new OpError(error.message, { code: error.code });
  return data as T;
}
