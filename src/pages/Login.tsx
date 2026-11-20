import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Aviso, Boton, Campo } from '@/components/ui';
import { Logo } from '@/components/Layout';

const CUENTAS = [
  { email: 'gerencia@taller.test', rol: 'Gerencia' },
  { email: 'asesor@taller.test', rol: 'Asesor' },
  { email: 'tecnico.a@taller.test', rol: 'Técnico A' },
  { email: 'tecnico.b@taller.test', rol: 'Técnico B' },
  { email: 'tecnico.c@taller.test', rol: 'Técnico C' },
  { email: 'tecnico.d@taller.test', rol: 'Técnico D' },
  { email: 'tecnico.e@taller.test', rol: 'Técnico E' },
];
const CLAVE_PRUEBA = 'Taller2026!';

export default function Login() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
    setEnviando(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message);
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={entrar} className="tarjeta space-y-4 p-6">
          <h1 className="titulo text-xl">Ingresar al taller</h1>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Campo etiqueta="Correo">
            <input className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <Campo etiqueta="Contraseña">
            <input className="campo" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
          </Campo>
          <Boton variante="primario" className="w-full" cargando={enviando}>Entrar</Boton>
        </form>

        <div className="tarjeta mt-4 p-4">
          <div className="etiqueta mb-2">Cuentas de prueba · contraseña <span className="font-mono normal-case text-grafito-200">{CLAVE_PRUEBA}</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CUENTAS.map((c) => (
              <button key={c.email} type="button" onClick={() => { setEmail(c.email); setClave(CLAVE_PRUEBA); }}
                className="rounded-md border border-grafito-700 bg-grafito-900 px-2 py-1.5 text-left hover:border-grafito-500">
                <div className="font-cond text-sm font-semibold uppercase tracking-wide text-tiza">{c.rol}</div>
                <div className="truncate text-[0.7rem] text-grafito-400">{c.email}</div>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-grafito-400">
          ¿Sos cliente? <Link to="/consulta" className="font-semibold text-tiza underline underline-offset-2">Consultá tu vehículo</Link>
        </p>
      </div>
    </div>
  );
}
