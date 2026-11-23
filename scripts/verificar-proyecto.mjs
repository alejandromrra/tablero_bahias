// Verifica un proyecto Supabase ya sembrado SIN escribir datos:
// solo lecturas e intentos que la base debe rechazar (un rechazo revierte todo).
//   node scripts/verificar-proyecto.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_ANON_KEY;
const CLAVE = process.env.CLAVE_PRUEBA ?? 'Taller2026!';
let fallas = 0;
const ok = (c, t) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${t}`); if (!c) fallas++; };
const sesion = async (email) => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: CLAVE }); if (error) throw new Error(email + ': ' + error.message);
  return c;
};
const g = await sesion('gerencia@taller.test');
const a = await sesion('asesor@taller.test');

// --- Configuración y catálogo del encargo
const { data: cfg } = await g.from('config').select('*').single();
const { data: fin } = await g.from('config_finanzas').select('*').single();
ok(+cfg.tarifa_mo === 450 && +cfg.material_pieza === 650 && +cfg.iva === 0.16 && +cfg.anticipo_pct === 0.5 && +cfg.curado_horas === 12 && +cfg.horneado_horas === 1 && cfg.cabina_max_piezas === 6,
  `config: $${cfg.tarifa_mo}/h, $${cfg.material_pieza}/pieza, IVA ${cfg.iva}, anticipo ${cfg.anticipo_pct}, curado ${cfg.curado_horas} h, horneado ${cfg.horneado_horas} h, cabina ${cfg.cabina_max_piezas} piezas`);
ok(+fin.markup_refacciones === 0.15 && +fin.bono_hora === 60 && +fin.umbral_bono_horas === 30, `finanzas: refacciones +${fin.markup_refacciones * 100}%, bono $${fin.bono_hora}/h sobre ${fin.umbral_bono_horas} h`);
const { data: hor } = await g.from('horario_taller').select('dia, inicio, fin').order('dia').order('inicio');
const txtHor = hor.map((h) => `${h.dia}:${h.inicio.slice(0, 5)}-${h.fin.slice(0, 5)}`).join(' ');
ok(txtHor === [1, 2, 3, 4, 5].map((d) => `${d}:09:00-14:00 ${d}:16:00-18:00`).join(' ') + ' 6:09:30-13:00', `horario: L-V 9-14 y 16-18, sáb 9:30-13`);
const { data: cat } = await g.from('catalogo_etapa').select('*').order('secuencia');
const fila = (t) => cat.find((c) => c.tipo === t);
const hs = (t) => [fila(t).h_leve, fila(t).h_medio, fila(t).h_fuerte, fila(t).h_reemplazo].map(Number).join('/');
ok(cat.map((c) => c.tipo).join() === 'desarmado,enderezado,preparacion,pintura,pulido_armado,control_calidad', 'etapas en orden del encargo');
ok(hs('desarmado') === '0.5/0.5/0.5/0.5' && hs('enderezado') === '1/2.5/4/0' && hs('preparacion') === '1/1.5/2/1' && hs('pintura') === '0.75/0.75/0.75/0.75'
  && hs('pulido_armado') === '0.75/0.75/0.75/0.75' && +fila('control_calidad').horas_fijas === 0.5 && fila('pulido_armado').especialidades.join() === 'pulido,armado',
  'horas por pieza: desarmado 0,5 · enderezado 1/2,5/4/0 · preparación 1/1,5/2/1 · pintura 0,75 · pulido y armado 0,75 · control 0,5');
const { data: areas } = await g.from('area').select('nombre, tipo, capacidad').order('orden');
ok(areas.map((x) => `${x.nombre}:${x.capacidad}`).join() === 'Bahía de enderezado 1:1,Bahía de enderezado 2:1,Bahía de preparación:2,Cabina de pintura:1,Bahía de armado y pulido:2', 'áreas y capacidades');
const { data: tecs } = await g.rpc('tecnicos_admin');
const t = Object.fromEntries(tecs.map((x) => [x.nombre.slice(-1), x]));
ok(t.A.especialidades.join() === 'enderezado,armado' && +t.A.tarifa_hora === 160 && t.B.especialidades.join() === 'enderezado' && +t.B.tarifa_hora === 150 && !t.B.dias_laborables.includes(6)
  && t.C.especialidades.join() === 'preparacion,pulido' && +t.C.tarifa_hora === 140 && t.D.especialidades.join() === 'pintura,preparacion' && +t.D.tarifa_hora === 180
  && t.E.especialidades.join() === 'armado,pulido' && +t.E.tarifa_hora === 130 && ['A', 'C', 'D', 'E'].every((k) => t[k].dias_laborables.includes(6)),
  'técnicos A-E: especialidades, $160/150/140/180/130, B sin sábados');

// --- Caso resuelto (criterio 9)
const { data: o1 } = await a.from('orden').select('id').eq('folio', 'OT-0001').single();
const { data: f1 } = await a.rpc('orden_finanzas', { p_orden: o1.id });
const p = f1.presupuesto;
ok(+p.horas_vendidas === 9 && +p.mano_obra === 4050 && +p.materiales === 1300 && +p.refacciones === 3220 && +p.subtotal === 8570 && +p.iva === 1371.2 && +p.total === 9941.2 && +p.anticipo === 4970.6,
  `caso resuelto: 9 h · MO ${p.mano_obra} · mat ${p.materiales} · ref ${p.refacciones} · subtotal ${p.subtotal} · IVA ${p.iva} · total ${p.total} · anticipo ${p.anticipo}`);
ok(!('margen' in f1), 'el asesor no ve el margen');
const { data: o2 } = await a.from('orden').select('id').eq('folio', 'OT-0002').single();
const { data: f2 } = await a.rpc('orden_finanzas', { p_orden: o2.id });
ok(+f2.saldo_cliente === 3500 && +f2.saldo_aseguradora === +f2.presupuesto.total - 3500, `aseguradora: deducible cliente ${f2.saldo_cliente} · saldo aseguradora ${f2.saldo_aseguradora} aparte`);

// --- Criterio 8: programables
const { data: lista } = await a.from('v_orden_lista').select('folio, estado, habilitada, atrasada').order('folio');
ok(lista.length > 0 && 'habilitada' in lista[0], 'la vista de órdenes tiene «habilitada» (SQL actualizado)');
const hab = lista.filter((x) => x.habilitada).map((x) => x.folio).join();
ok(hab === 'OT-0002,OT-0003,OT-0004,OT-0005', `programables: ${hab} (OT-0001 sin anticipo queda fuera)`);

// --- Criterio 10: atraso
const { data: pl } = await a.from('v_planificador').select('orden_folio, atrasada').eq('orden_folio', 'OT-0003');
const tz = 'America/Mexico_City';
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const dd = new Date(`${hoy}T12:00:00Z`); dd.setUTCDate(dd.getUTCDate() + 1 - (dd.getUTCDay() || 7));
const lunes = dd.toISOString().slice(0, 10);
const { data: panel } = await g.rpc('panel_gerencia', { p_semana: lunes });
ok(pl.length > 0 && pl.every((x) => x.atrasada) && panel.atrasos.some((x) => x.folio === 'OT-0003'), 'OT-0003 atrasada en planificador y panel');

// --- Reglas del planificador (rechazos: no escriben nada)
const etapa = async (folio, tipo) => { const { data: o } = await a.from('orden').select('id').eq('folio', folio).single();
  const { data: e } = await a.from('etapa').select('id').eq('orden_id', o.id).eq('tipo', tipo).eq('carga', 1).single(); return e.id; };
const tec = async (n) => (await a.from('tecnico').select('id').eq('nombre', 'Técnico ' + n).single()).data.id;
const ar = async (n) => (await a.from('area').select('id').eq('nombre', n).single()).data.id;
const en = (dia, hhmm) => { const x = new Date(`${lunes}T${hhmm}:00-06:00`); x.setUTCDate(x.getUTCDate() + dia); return x.toISOString(); };
const { count: antes } = await g.from('bloque').select('*', { count: 'exact', head: true });
const intento = async (titulo, payload, esperado, codigo) => {
  const r = await a.rpc('operar', { p_op_id: randomUUID(), p_tipo: 'programar_bloque', p_payload: payload });
  ok(!!r.error && r.error.message.includes(esperado) && (!codigo || r.error.code === codigo), `${titulo}: ${r.error ? r.error.message : 'NO LO RECHAZÓ'}`);
};
await intento('8 · particular sin anticipo', { etapa_id: await etapa('OT-0001', 'desarmado'), tecnico_id: await tec('A'), area_id: await ar('Bahía de armado y pulido'), inicio: en(2, '09:00') }, 'no tiene el 50% de anticipo');
await intento('2 · técnico ocupado', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('C'), area_id: await ar('Bahía de preparación'), inicio: en(1, '12:00') }, 'Técnico C ya tiene un bloque', 'PT409');
await intento('3 · etapa anterior', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('D'), area_id: await ar('Bahía de preparación'), inicio: en(0, '16:00') }, 'Enderezado termina');
await intento('4 · especialidad', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('A'), area_id: await ar('Bahía de preparación'), inicio: en(1, '09:00') }, 'no tiene la especialidad');
{ // 5 · la cabina ya tiene la carga de OT-0003 (pintura + horneado): no entra otra cosa en esa franja
  const r = await g.rpc('operar', { p_op_id: randomUUID(), p_tipo: 'programar_mantenimiento', p_payload: { area_id: await ar('Cabina de pintura'), inicio: en(1, '17:00'), fin: en(1, '17:30') } });
  ok(!!r.error && r.error.code === 'PT409' && r.error.message.includes('Cabina de pintura está ocupada'), `5 · cabina con una carga: ${r.error ? r.error.message : 'NO LO RECHAZÓ'}`);
}
await intento('7 · armado con refacciones pendientes', { etapa_id: await etapa('OT-0002', 'pulido_armado'), tecnico_id: await tec('E'), area_id: await ar('Bahía de armado y pulido'), inicio: en(4, '09:00') }, 'refacción(es) sin recibir');
await intento('horario · fuera de franja', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('D'), area_id: await ar('Bahía de preparación'), inicio: en(2, '14:30') }, 'Fuera del horario del taller');
await intento('horario · viernes 15:00 (corte de mediodía)', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('D'), area_id: await ar('Bahía de preparación'), inicio: en(4, '15:00') }, 'Fuera del horario');
await intento('ausencia de C', { etapa_id: await etapa('OT-0002', 'preparacion'), tecnico_id: await tec('C'), area_id: await ar('Bahía de preparación'), inicio: en(4, '09:00') }, 'Técnico C está ausente');
const { count: despues } = await g.from('bloque').select('*', { count: 'exact', head: true });
ok(antes === despues, `ningún rechazo dejó escrituras (bloques: ${antes} → ${despues})`);
const { data: tramos } = await a.from('v_planificador').select('folio, tramo, tramos').eq('orden_folio', 'OT-0002').eq('etapa_tipo', 'enderezado');
ok(tramos.length === 2 && tramos.every((x) => x.tramos === 2), `enderezado de OT-0002 partido en el corte de mediodía: ${tramos.map((x) => x.folio).join(' + ')}`);
console.log(fallas ? `\n${fallas} FALLAS` : '\nProyecto verificado: todo OK');
process.exit(fallas ? 1 : 0);
