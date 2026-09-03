import { signOut, useUsuarioActual } from '../auth/firebaseAuth';

const ROL_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  AUDITOR: 'Auditor',
  OPERADOR: 'Operador',
};

/** Bloque de cuenta en la barra lateral: quién soy + cerrar sesión. */
export function UserSwitcher() {
  const actual = useUsuarioActual();
  if (!actual) return null;

  return (
    <div
      style={{
        marginTop: '.5rem',
        paddingTop: '.75rem',
        borderTop: '1px solid var(--border)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{actual.nombre}</div>
      <div className="muted" style={{ fontSize: '.75rem', marginBottom: '.4rem' }}>
        {ROL_LABEL[actual.rolGlobal] ?? actual.rolGlobal}
      </div>
      <button className="sm ghost" onClick={() => void signOut()}>
        Cerrar sesión
      </button>
    </div>
  );
}
