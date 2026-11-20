import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

export const configurado = Boolean(url && anon);

// Solo clave pública (anon). La service_role nunca entra al navegador.
export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'falta-clave', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tablero-bahias-auth' },
});
