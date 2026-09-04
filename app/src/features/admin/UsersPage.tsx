import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { toast } from '../../components/toast';
import { esSuperAdmin, useUsuarioActual } from '../../auth/firebaseAuth';
import { funcs } from '../../firebase';
import { repo } from '../../data/repo';
import { useRepo } from '../../data/useRepo';
import type { RolGlobal } from '../../domain/types';

const ROLES: RolGlobal[] = ['ADMIN', 'AUDITOR', 'OPERADOR'];
const hoyISO = () => new Date().toISOString().slice(0, 10);
const vencido = (caducaEn?: string) => !!caducaEn && caducaEn <= hoyISO();

type Payload =
  | { accion: 'crear'; email: string; password: string; nombre: string; rolGlobal: RolGlobal; caducaEn?: string }
  | { accion: 'actualizar'; uid: string; nombre?: string; rolGlobal?: RolGlobal; caducaEn?: string | null }
  | { accion: 'eliminar'; uid: string };

const administrar = httpsCallable(funcs, 'administrarUsuarios');

export function UsersPage() {
  useRepo();
  const yo = useUsuarioActual();
  const [enviando, setEnviando] = useState(false);

  // Formulario de alta.
  const [nuevo, setNuevo] = useState({
    email: '',
    nombre: '',
    password: '',
    rolGlobal: 'OPERADOR' as RolGlobal,
    caducaEn: '',
  });

  if (yo && yo.rolGlobal !== 'ADMIN') return <Navigate to="/sesiones" replace />;

  const usuarios = repo
    .usuarios()
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  async function ejecutar(payload: Payload, exito: string): Promise<boolean> {
    setEnviando(true);
    try {
      await administrar(payload);
      toast(exito);
      return true;
    } catch (e) {
      toast((e as Error).message || 'No se pudo completar la operación.');
      return false;
    } finally {
      setEnviando(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const ok = await ejecutar(
      {
        accion: 'crear',
        email: nuevo.email.trim(),
        password: nuevo.password,
        nombre: nuevo.nombre.trim(),
        rolGlobal: nuevo.rolGlobal,
        ...(nuevo.caducaEn ? { caducaEn: nuevo.caducaEn } : {}),
      },
      `Cuenta creada. Contraseña temporal: ${nuevo.password} — compártela con la persona.`,
    );
    if (ok) {
      setNuevo({ email: '', nombre: '', password: '', rolGlobal: 'OPERADOR', caducaEn: '' });
    }
  }

  return (
    <>
      <h1>Usuarios</h1>
      <p className="lead">
        Gestiona las cuentas del sistema: crea nuevas, cambia el rol global, fija
        una fecha de caducidad o elimínalas por completo.
      </p>

      <h2>Crear usuario</h2>
      <form className="card" onSubmit={crear} style={{ maxWidth: 480 }}>
        <label>
          Correo
          <input
            type="email"
            autoComplete="off"
            value={nuevo.email}
            onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
            required
          />
        </label>
        <label>
          Nombre
          <input
            type="text"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            required
          />
        </label>
        <label>
          Contraseña temporal
          <input
            type="text"
            autoComplete="off"
            value={nuevo.password}
            onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
            required
            minLength={6}
          />
        </label>
        <label>
          Rol global
          <select
            value={nuevo.rolGlobal}
            onChange={(e) => setNuevo({ ...nuevo, rolGlobal: e.target.value as RolGlobal })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha de caducidad <span className="muted">(opcional)</span>
          <input
            type="date"
            value={nuevo.caducaEn}
            min={hoyISO()}
            onChange={(e) => setNuevo({ ...nuevo, caducaEn: e.target.value })}
          />
        </label>
        <button className="primary" type="submit" disabled={enviando} style={{ marginTop: '1rem' }}>
          {enviando ? '…' : 'Crear cuenta'}
        </button>
      </form>

      <h2 style={{ marginTop: '2rem' }}>Cuentas existentes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th style={{ width: 150 }}>Rol global</th>
              <th style={{ width: 160 }}>Caduca</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const bootstrap = esSuperAdmin(u.id);
              const esYo = u.id === yo?.id;
              return (
                <tr key={u.id}>
                  <td>
                    <input
                      key={`n-${u.id}-${u.nombre}`}
                      type="text"
                      defaultValue={u.nombre}
                      disabled={enviando}
                      style={{ maxWidth: 200 }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== u.nombre) {
                          void ejecutar(
                            { accion: 'actualizar', uid: u.id, nombre: v },
                            `${v}: nombre actualizado`,
                          );
                        }
                      }}
                    />
                    {esYo && <span className="badge muted"> tú</span>}
                    {bootstrap && <span className="badge ok"> principal</span>}
                  </td>
                  <td>
                    <code className="inline">{u.email ?? '—'}</code>
                  </td>
                  <td>
                    <select
                      value={u.rolGlobal}
                      disabled={bootstrap || enviando}
                      onChange={(e) =>
                        void ejecutar(
                          { accion: 'actualizar', uid: u.id, rolGlobal: e.target.value as RolGlobal },
                          `${u.nombre} → ${e.target.value}`,
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      key={`c-${u.id}-${u.caducaEn ?? ''}`}
                      type="date"
                      defaultValue={u.caducaEn ?? ''}
                      disabled={bootstrap || enviando}
                      onChange={(e) =>
                        void ejecutar(
                          { accion: 'actualizar', uid: u.id, caducaEn: e.target.value || null },
                          e.target.value
                            ? `${u.nombre}: caduca el ${e.target.value}`
                            : `${u.nombre}: sin caducidad`,
                        )
                      }
                    />
                    {vencido(u.caducaEn) && <span className="badge danger"> vencida</span>}
                  </td>
                  <td>
                    {!bootstrap && !esYo && (
                      <button
                        className="danger sm"
                        disabled={enviando}
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Eliminar la cuenta de ${u.nombre}? Se borra su acceso y sus asignaciones de sesión. Los conteos que registró se conservan.`,
                            )
                          ) {
                            void ejecutar(
                              { accion: 'eliminar', uid: u.id },
                              `${u.nombre}: cuenta eliminada`,
                            );
                          }
                        }}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {usuarios.length === 0 && <p className="muted">Aún no hay usuarios registrados.</p>}
    </>
  );
}
