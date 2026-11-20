import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'alerta';
const estilos: Record<Variante, string> = {
  primario: 'bg-tiza text-grafito-950 hover:bg-white',
  secundario: 'border border-grafito-600 bg-grafito-800 text-tiza hover:bg-grafito-700',
  fantasma: 'text-grafito-300 hover:bg-grafito-800 hover:text-tiza',
  peligro: 'border border-grafito-500 bg-grafito-700 text-tiza hover:bg-grafito-600',
  alerta: 'bg-alerta text-grafito-950 hover:bg-alerta-claro',
};

export function Boton({ variante = 'secundario', className = '', cargando, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 font-cond text-sm font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${estilos[variante]} ${className}`}>
      {cargando && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Campo({ etiqueta, children, ayuda, className = '' }: { etiqueta: string; children: ReactNode; ayuda?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-grafito-400">{ayuda}</span>}
    </label>
  );
}

export function Aviso({ tipo = 'info', children, accion }: { tipo?: 'info' | 'error' | 'conflicto' | 'atraso' | 'ok'; children: ReactNode; accion?: ReactNode }) {
  const c = {
    info: 'border-grafito-600 bg-grafito-800 text-grafito-200',
    error: 'border-grafito-400 bg-grafito-800 text-tiza',
    ok: 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200',
    conflicto: 'border-alerta bg-alerta-fondo text-alerta-claro',
    atraso: 'border-alerta bg-alerta-fondo text-alerta-claro',
  }[tipo];
  return (
    <div role={tipo === 'error' || tipo === 'conflicto' ? 'alert' : 'status'} className={`flex flex-wrap items-start gap-3 rounded-md border-l-4 px-4 py-3 text-sm ${c}`}>
      <div className="min-w-0 flex-1">
        {tipo === 'atraso' && <strong className="mr-1 font-cond uppercase tracking-wider">Atraso ·</strong>}
        {tipo === 'conflicto' && <strong className="mr-1 font-cond uppercase tracking-wider">Conflicto ·</strong>}
        {tipo === 'error' && <strong className="mr-1 font-cond uppercase tracking-wider">Rechazado ·</strong>}
        {children}
      </div>
      {accion}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-grafito-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-grafito-500 border-t-transparent" />{texto}</div>;
}

export function Encabezado({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="titulo">{titulo}</h1>
        {sub && <p className="mt-0.5 text-sm text-grafito-400">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const colorEstado: Record<string, string> = {
  Presupuesto: 'bg-grafito-700 text-grafito-200',
  'En proceso': 'bg-sky-900/70 text-sky-200',
  'Esperando refacciones': 'bg-violet-900/70 text-violet-200',
  Terminada: 'bg-emerald-900/70 text-emerald-200',
  Entregada: 'bg-grafito-600 text-tiza',
  Cancelada: 'bg-grafito-800 text-grafito-400 line-through',
  Pendiente: 'bg-grafito-700 text-grafito-200',
  Bloqueada: 'bg-violet-900/70 text-violet-200',
  Programada: 'bg-sky-900/70 text-sky-200',
  'En curso': 'bg-yellow-300 text-grafito-950',
  Pausada: 'bg-grafito-600 text-tiza',
  Pedida: 'bg-violet-900/70 text-violet-200',
  Recibida: 'bg-emerald-900/70 text-emerald-200',
  Borrador: 'bg-grafito-700 text-grafito-200',
  Autorizado: 'bg-emerald-900/70 text-emerald-200',
  Abierta: 'bg-grafito-700 text-grafito-200',
  Cerrada: 'bg-grafito-200 text-grafito-950',
};

export function Estado({ valor }: { valor: string }) {
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 font-cond text-xs font-semibold uppercase tracking-wide ${colorEstado[valor] ?? 'bg-grafito-700'}`}>{valor}</span>;
}

export function Atrasada() {
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-alerta px-2 py-0.5 font-cond text-xs font-bold uppercase tracking-wider text-grafito-950">▲ Atrasada</span>;
}

export function Kpi({ etiqueta, valor, sub, alerta }: { etiqueta: string; valor: ReactNode; sub?: ReactNode; alerta?: boolean }) {
  return (
    <div className={`tarjeta p-4 ${alerta ? 'border-alerta' : ''}`}>
      <div className="etiqueta">{etiqueta}</div>
      <div className={`font-cond text-3xl font-bold tabular-nums ${alerta ? 'text-alerta' : 'text-tiza'}`}>{valor}</div>
      {sub && <div className="mt-1 text-xs text-grafito-400">{sub}</div>}
    </div>
  );
}

export function Modal({ abierto, titulo, onCerrar, children, ancho = 'max-w-xl' }: { abierto: boolean; titulo: string; onCerrar: () => void; children: ReactNode; ancho?: string }) {
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className={`tarjeta w-full ${ancho} shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-grafito-700 px-5 py-3">
          <h2 className="font-cond text-lg font-bold uppercase tracking-wide">{titulo}</h2>
          <button onClick={onCerrar} className="rounded p-1 text-grafito-400 hover:bg-grafito-700 hover:text-tiza" aria-label="Cerrar">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
