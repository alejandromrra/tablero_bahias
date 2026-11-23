import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Rol = 'gerencia' | 'asesor' | 'tecnico';
export type Perfil = { user_id: string; rol: Rol; nombre: string; tecnico_id: string | null };

type Ctx = { session: Session | null; perfil: Perfil | null; cargando: boolean; salir: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ session: null, perfil: null, cargando: true, salir: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sesionLista, setSesionLista] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSesionLista(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!sesionLista) return;
      if (!session) { setPerfil(null); setCargando(false); return; }
      setCargando(true);
      const { data } = await supabase.from('perfil').select('user_id, rol, nombre, tecnico_id').eq('user_id', session.user.id).maybeSingle();
      if (vivo) { setPerfil((data as Perfil) ?? null); setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [session?.user.id, sesionLista]);

  const salir = async () => { await supabase.auth.signOut(); };
  return <AuthCtx.Provider value={{ session, perfil, cargando, salir }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
