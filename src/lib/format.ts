export const TZ = 'America/Mexico_City';

const mxn = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
export const dinero = (n: number | string | null | undefined) => mxn.format(Number(n ?? 0));
export const horas = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`;

const partes = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, ...opts }).format(d);
export const fechaHora = (s?: string | null) => (s ? partes(new Date(s), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const fecha = (s?: string | null) => (s ? partes(new Date(s), { weekday: 'short', day: '2-digit', month: 'short' }) : '—');
export const hora = (s?: string | null) => (s ? partes(new Date(s), { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

/** Componentes de fecha/hora en la zona del taller */
export function enZona(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { fecha: `${p.year}-${p.month}-${p.day}`, h, m: Number(p.minute), min: h * 60 + Number(p.minute) };
}

/** "2026-11-19" + "11:30" en la zona del taller → Date (UTC) */
export function desdeZona(fechaISO: string, hhmm: string): Date {
  const guess = new Date(`${fechaISO}T${hhmm}:00Z`);
  const z = enZona(guess);
  const desfase = (Date.parse(`${z.fecha}T${String(z.h).padStart(2, '0')}:${String(z.m).padStart(2, '0')}:00Z`) - guess.getTime());
  return new Date(guess.getTime() - desfase);
}

export const sumarDias = (fechaISO: string, n: number) => {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Lunes de la semana (zona del taller) */
export function lunesDe(d = new Date()) {
  const f = enZona(d).fecha;
  const dow = new Date(`${f}T12:00:00Z`).getUTCDay() || 7;
  return sumarDias(f, 1 - dow);
}

export const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const etiquetaDia = (fechaISO: string) => {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  return `${DIAS[d.getUTCDay() || 7]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const aMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const deMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
