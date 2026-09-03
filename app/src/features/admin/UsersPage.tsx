import { toast } from '../../components/toast';
import { esSuperAdmin, useSesion } from '../../auth/firebaseAuth';
import { repo } from '../../data/repo';
import { useRepo } from '../../data/useRepo';
import type { RolGlobal } from '../../domain/types';

const ROLES: RolGlobal[] = ['ADMIN', 'AUDITOR', 'OPERADOR'];

export function UsersPage() {
  useRepo();
  const { uid } = useSesion();
  const usuarios = repo
    .usuarios()
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <>
      <h1>Usuarios</h1>
      <p className="lead">
        Asigna el rol global de cada persona. Los usuarios se crean al registrarse
        en la pantalla de acceso; aquí solo se les cambia el rol.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>UID</th>
              <th style={{ width: 160 }}>Rol global</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const bloqueado = esSuperAdmin(u.id);
              return (
                <tr key={u.id}>
                  <td>
                    {u.nombre}
                    {u.id === uid && <span className="badge muted"> tú</span>}
                    {bloqueado && <span className="badge ok"> super admin</span>}
                  </td>
                  <td>
                    <code className="inline">{u.id.slice(0, 12)}…</code>
                  </td>
                  <td>
                    <select
                      value={u.rolGlobal}
                      disabled={bloqueado}
                      onChange={(e) => {
                        repo.upsertUsuario({
                          ...u,
                          rolGlobal: e.target.value as RolGlobal,
                        });
                        toast(`${u.nombre} → ${e.target.value}`);
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {usuarios.length === 0 && (
        <p className="muted">Aún no hay usuarios registrados.</p>
      )}
    </>
  );
}
