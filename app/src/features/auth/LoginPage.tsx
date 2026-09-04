import { useState } from 'react';
import { signIn, signUp, useSesion } from '../../auth/firebaseAuth';

export function LoginPage() {
  const { aviso } = useSesion();
  const [modo, setModo] = useState<'entrar' | 'crear'>('entrar');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      if (modo === 'entrar') await signIn(email, pass);
      else await signUp(email, pass, nombre);
    } catch (err) {
      setError(traducir((err as { code?: string }).code) ?? (err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
      }}
    >
      <form
        onSubmit={enviar}
        className="card"
        style={{ width: '100%', maxWidth: 360 }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <img src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: 8 }} />
          <h1 style={{ fontSize: '1.15rem', margin: '.5rem 0 0' }}>QR Inventarios</h1>
          <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>by NelSystems</p>
        </div>

        {aviso && !error && (
          <p className="badge warn" style={{ display: 'block', marginBottom: '.6rem' }}>
            {aviso}
          </p>
        )}

        {modo === 'crear' && (
          <label>
            Nombre
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
        )}
        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error && (
          <p className="badge danger" style={{ display: 'block', marginTop: '.6rem' }}>
            {error}
          </p>
        )}

        <button
          className="primary"
          type="submit"
          disabled={cargando}
          style={{ width: '100%', marginTop: '1rem' }}
        >
          {cargando ? '…' : modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
        </button>

        <button
          type="button"
          className="ghost sm"
          style={{ width: '100%', marginTop: '.5rem' }}
          onClick={() => {
            setModo(modo === 'entrar' ? 'crear' : 'entrar');
            setError(null);
          }}
        >
          {modo === 'entrar'
            ? '¿No tienes cuenta? Crear una'
            : '¿Ya tienes cuenta? Entrar'}
        </button>
      </form>
    </div>
  );
}

function traducir(code?: string): string | null {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos.';
    case 'auth/email-already-in-use':
      return 'Ese correo ya tiene cuenta.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Correo inválido.';
    case 'auth/network-request-failed':
      return 'Sin conexión con el servidor de autenticación.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento.';
    default:
      return null;
  }
}
