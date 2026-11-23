import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth, type Rol } from '@/lib/auth';

type Item = { a: string; texto: string; roles: Rol[] };
const ITEMS: Item[] = [
  { a: '/planificador', texto: 'Planificador', roles: ['gerencia', 'asesor'] },
  { a: '/ordenes', texto: 'Órdenes', roles: ['gerencia', 'asesor'] },
  { a: '/pagos', texto: 'Pagos', roles: ['gerencia', 'asesor'] },
  { a: '/refacciones', texto: 'Refacciones', roles: ['gerencia', 'asesor'] },
  { a: '/tecnico', texto: 'Mi trabajo', roles: ['tecnico'] },
  { a: '/panel', texto: 'Panel', roles: ['gerencia'] },
  { a: '/liquidacion', texto: 'Liquidación', roles: ['gerencia'] },
  { a: '/configuracion', texto: 'Configuración', roles: ['gerencia'] },
];

const ROL_TEXTO: Record<Rol, string> = { gerencia: 'Gerencia', asesor: 'Asesor', tecnico: 'Técnico' };

export function Logo({ chico, oscuro }: { chico?: boolean; oscuro?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className={chico ? 'h-6 w-6' : 'h-8 w-8'} aria-hidden>
        <rect width="32" height="32" rx="6" fill="#1F2933" stroke="#36404B" />
        <rect x="5" y="8" width="10" height="5" rx="1" fill="#3E7CB1" />
        <rect x="13" y="15" width="12" height="5" rx="1" fill="#2F9E6E" />
        <rect x="8" y="22" width="9" height="5" rx="1" fill="#8E5BB5" />
      </svg>
      <span className={`font-cond text-base font-bold uppercase leading-none tracking-wider whitespace-nowrap ${oscuro ? 'text-white' : 'text-grafito-900'}`}>Tablero<span className={oscuro ? 'text-grafito-400' : 'text-grafito-500'}> de bahías</span></span>
    </div>
  );
}

export default function Layout({ children }: { children?: ReactNode }) {
  const { perfil, salir } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const items = ITEMS.filter((i) => perfil && i.roles.includes(perfil.rol));
  const enlaces = items.map((i) => (
    <NavLink key={i.a} to={i.a} onClick={() => setAbierto(false)}
      className={({ isActive }) => `block rounded-md px-3 py-2 font-cond text-[0.95rem] font-semibold uppercase tracking-wide transition ${isActive ? 'bg-white text-grafito-900' : 'text-grafito-300 hover:bg-grafito-800 hover:text-white'}`}>
      {i.texto}
    </NavLink>
  ));
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="no-print border-b border-grafito-950 bg-grafito-900 text-white md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:py-5">
          <Logo oscuro />
          <button className="rounded p-2 text-grafito-300 md:hidden" onClick={() => setAbierto(!abierto)} aria-label="Menú">☰</button>
        </div>
        <nav className={`${abierto ? 'block' : 'hidden'} space-y-1 px-3 pb-3 md:block md:flex-1`}>{enlaces}</nav>
        <div className={`${abierto ? 'block' : 'hidden'} border-t border-grafito-800 px-4 py-3 md:block`}>
          <div className="text-sm font-semibold text-white">{perfil?.nombre}</div>
          <div className="mb-2 font-cond text-xs uppercase tracking-wider text-grafito-400">{perfil && ROL_TEXTO[perfil.rol]}</div>
          <button onClick={salir} className="font-cond text-xs font-semibold uppercase tracking-wider text-grafito-300 hover:text-white">Cerrar sesión</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-7 md:py-7">{children ?? <Outlet />}</main>
    </div>
  );
}
