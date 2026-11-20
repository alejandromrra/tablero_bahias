// Prueba guiada por la API: dos sesiones (gerencia y asesor) compiten por la
// MISMA cabina en el MISMO horario. Usa solo la clave pública (anon).
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/carrera-cabina.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1); }
const CLAVE = process.env.CLAVE_PRUEBA ?? 'Taller2026!';

const sesion = async (email) => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: CLAVE });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
};
const [s1, s2] = await Promise.all([sesion('gerencia@taller.test'), sesion('asesor@taller.test')]);

// Jueves de esta semana, 11:00 hora del taller (las órdenes OT-0004/OT-0005 de la semilla)
const tz = 'America/Mexico_City';
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)));
const jueves = d.toISOString().slice(0, 10);
const inicio = new Date(`${jueves}T11:00:00-06:00`).toISOString();

const datos = async (c, folio, tecnico) => {
  const { data: o } = await c.from('orden').select('id').eq('folio', folio).single();
  const { data: e } = await c.from('etapa').select('id').eq('orden_id', o.id).eq('tipo', 'pintura').single();
  const { data: t } = await c.from('tecnico').select('id').eq('nombre', tecnico).single();
  const { data: a } = await c.from('area').select('id').eq('nombre', 'Cabina de pintura').single();
  return { etapa_id: e.id, tecnico_id: t.id, area_id: a.id, inicio };
};
const [p1, p2] = await Promise.all([datos(s1, 'OT-0004', 'Técnico D'), datos(s2, 'OT-0005', 'Técnico B')]);

console.log(`Ambas sesiones piden la cabina el ${jueves} 11:00…`);
const [r1, r2] = await Promise.all([
  s1.rpc('operar', { p_op_id: randomUUID(), p_tipo: 'programar_bloque', p_payload: p1 }),
  s2.rpc('operar', { p_op_id: randomUUID(), p_tipo: 'programar_bloque', p_payload: p2 }),
]);
const fmt = (n, r) => r.error ? `${n}: ✗ ${r.error.code} ${r.error.message}` : `${n}: ✓ ganó, bloque ${r.data.folio}`;
console.log(fmt('Gerencia (OT-0004)', r1));
console.log(fmt('Asesor   (OT-0005)', r2));
const ok = [r1, r2].filter((r) => !r.error).length === 1 && [r1, r2].some((r) => r.error?.code === 'PT409');
const { data: cab } = await s1.from('v_planificador').select('folio, orden_folio').eq('area_id', p1.area_id).gte('inicio', inicio).lt('inicio', new Date(Date.parse(inicio) + 3600e3).toISOString());
console.log('Bloques en cabina a esa hora:', cab);
console.log(ok && cab.length === 1 ? 'OK: gana una sola sesión; la otra ve el conflicto y no ocupa recursos.' : 'FALLO');
process.exit(ok && cab.length === 1 ? 0 : 1);
