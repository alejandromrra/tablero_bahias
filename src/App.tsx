import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, type Rol } from '@/lib/auth';
import { configurado } from '@/lib/supabase';
import Layout from '@/components/Layout';
import { Aviso, Cargando } from '@/components/ui';
import Login from '@/pages/Login';
import Planificador from '@/pages/Planificador';
import Ordenes from '@/pages/Ordenes';
import OrdenDetalle from '@/pages/OrdenDetalle';
import NuevaOrden from '@/pages/NuevaOrden';
import Presupuesto from '@/pages/Presupuesto';
import Pagos from '@/pages/Pagos';
import Refacciones from '@/pages/Refacciones';
import VistaTecnico from '@/pages/VistaTecnico';
import Liquidacion from '@/pages/Liquidacion';
import Configuracion from '@/pages/Configuracion';
import ConsultaPublica from '@/pages/ConsultaPublica';
import Panel from '@/pages/Panel';

const inicioPorRol: Record<Rol, string> = { gerencia: '/panel', asesor: '/planificador', tecnico: '/tecnico' };

function Protegida({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { session, perfil, cargando } = useAuth();
  if (cargando) return <Cargando />;
  if (!session) return <Navigate to="/login" replace />;
  if (!perfil) return <div className="p-6"><Aviso tipo="error">Tu usuario no tiene perfil asignado. Pedile a gerencia que lo cargue en la tabla <code>perfil</code>.</Aviso></div>;
  if (!roles.includes(perfil.rol)) return <Navigate to={inicioPorRol[perfil.rol]} replace />;
  return <Layout>{children}</Layout>;
}

function Inicio() {
  const { session, perfil, cargando } = useAuth();
  if (cargando) return <Cargando />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={perfil ? inicioPorRol[perfil.rol] : '/login'} replace />;
}

const GA: Rol[] = ['gerencia', 'asesor'];
const G: Rol[] = ['gerencia'];

export default function App() {
  if (!configurado) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Aviso tipo="error">Faltan <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>. Copiá <code>.env.example</code> a <code>.env.local</code> y completalos.</Aviso>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/login" element={<Login />} />
      <Route path="/consulta" element={<ConsultaPublica />} />
      <Route path="/planificador" element={<Protegida roles={GA}><Planificador /></Protegida>} />
      <Route path="/ordenes" element={<Protegida roles={GA}><Ordenes /></Protegida>} />
      <Route path="/ordenes/nueva" element={<Protegida roles={GA}><NuevaOrden /></Protegida>} />
      <Route path="/ordenes/:id" element={<Protegida roles={GA}><OrdenDetalle /></Protegida>} />
      <Route path="/ordenes/:id/presupuesto" element={<Protegida roles={GA}><Presupuesto /></Protegida>} />
      <Route path="/pagos" element={<Protegida roles={GA}><Pagos /></Protegida>} />
      <Route path="/refacciones" element={<Protegida roles={GA}><Refacciones /></Protegida>} />
      <Route path="/tecnico" element={<Protegida roles={['tecnico', 'gerencia']}><VistaTecnico /></Protegida>} />
      <Route path="/liquidacion" element={<Protegida roles={G}><Liquidacion /></Protegida>} />
      <Route path="/configuracion" element={<Protegida roles={G}><Configuracion /></Protegida>} />
      <Route path="/panel" element={<Protegida roles={G}><Panel /></Protegida>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
