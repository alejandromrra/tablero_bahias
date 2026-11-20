const stamp = (s: string | Date) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export type EventoIcs = { uid: string; inicio: string | Date; fin: string | Date; titulo: string; descripcion?: string };

export function generarIcs(eventos: EventoIcs[]) {
  const lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tablero de bahias//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of eventos) {
    lineas.push('BEGIN:VEVENT', `UID:${e.uid}@tablero-bahias`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(e.inicio)}`, `DTEND:${stamp(e.fin)}`, `SUMMARY:${esc(e.titulo)}`);
    if (e.descripcion) lineas.push(`DESCRIPTION:${esc(e.descripcion)}`);
    lineas.push('END:VEVENT');
  }
  lineas.push('END:VCALENDAR');
  return lineas.join('\r\n');
}

export function descargar(nombre: string, contenido: string, tipo = 'text/calendar;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
