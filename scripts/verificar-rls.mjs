// Verifica la RLS con consultas directas a la API de Supabase (solo clave anon).
//   node scripts/verificar-rls.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_ANON_KEY;
const sesion = async (email) => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  if (email) { const { error } = await c.auth.signInWithPassword({ email, password: process.env.CLAVE_PRUEBA ?? 'Taller2026!' }); if (error) throw error; }
  return c;
};
let fallas = 0;
const chequeo = (ok, texto) => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${texto}`); if (!ok) fallas++; };

const g = await sesion('gerencia@taller.test');
const { data: todas } = await g.from('orden').select('id, folio');
const ajena = todas.find((o) => o.folio === 'OT-0005');

const t = await sesion('tecnico.a@taller.test');
const { data: yo } = await t.from('perfil').select('tecnico_id').single();
const { data: bloques } = await t.from('bloque').select('id, folio, tecnico_id');
chequeo(bloques.length > 0 && bloques.every((b) => b.tecnico_id === yo.tecnico_id), `técnico A lee ${bloques.length} bloques, todos suyos`);
const { data: ordenes } = await t.from('orden').select('id, folio');
chequeo(ordenes.length > 0 && !ordenes.some((o) => o.folio === 'OT-0005'), `ve solo sus órdenes: ${ordenes.map((o) => o.folio).join(', ')}`);
const r1 = await t.from('orden').select('*').eq('id', ajena.id);
chequeo(!!r1.error, `select * de orden (incluye deducible) → ${r1.error?.message}`);
const r2 = await t.from('orden').select('id, folio').eq('id', ajena.id);
chequeo(r2.data?.length === 0, 'cambiar el id por el de OT-0005 devuelve 0 filas');
for (const tabla of ['presupuesto', 'pago', 'refaccion', 'cliente', 'config', 'config_finanzas', 'liquidacion_detalle']) {
  const r = await t.from(tabla).select(tabla === 'refaccion' ? 'id, precio_venta' : '*');
  chequeo(!r.error && r.data.length === 0, `${tabla}: 0 filas`);
}
const r3 = await t.from('tecnico').select('tarifa_hora');
chequeo(!!r3.error, `tecnico.tarifa_hora → ${r3.error?.message}`);
const r4 = await t.rpc('orden_finanzas', { p_orden: ordenes[0].id });
chequeo(r4.data === null, 'orden_finanzas de su propia orden → null (sin importes)');
const r5 = await t.from('bloque').insert({ area_id: '20000000-0000-4000-8000-000000000004', inicio: new Date().toISOString(), fin: new Date(Date.now() + 36e5).toISOString(), tipo: 'mantenimiento' });
chequeo(!!r5.error, `insertar un bloque directo → ${r5.error?.message}`);

const anon = await sesion(null);
const r6 = await anon.from('orden').select('id');
chequeo(!!r6.error || r6.data.length === 0, 'anon no lee órdenes');
const r7 = await anon.rpc('consulta_publica', { p_folio: 'OT-0002', p_placa: 'PZK-482-B' });
chequeo(r7.data === null, 'consulta pública con folio ajeno y la placa de OT-0001 → null');
const r8 = await anon.rpc('consulta_publica', { p_folio: 'OT-0001', p_placa: 'PZK-482-B' });
chequeo(r8.data && Object.keys(r8.data).sort().join() === 'etapa_actual,fecha_prometida,saldo', `consulta pública propia → ${JSON.stringify(r8.data)}`);
console.log(fallas ? `\n${fallas} FALLAS` : '\nRLS verificada por la API: todo OK');
process.exit(fallas ? 1 : 0);
