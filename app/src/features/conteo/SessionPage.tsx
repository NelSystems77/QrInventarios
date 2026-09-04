import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../components/toast';
import { useUsuarioActual } from '../../auth/firebaseAuth';
import { repo } from '../../data/repo';
import {
  asignarMiembro,
  atenderAlerta,
  cerrarSesion,
  crearUbicacion,
  eliminarSesion,
  progresoSesion,
  purgarMiembrosHuerfanos,
  viewerDeSesion,
} from '../../data/conteoService';
import { useRepo } from '../../data/useRepo';
import { useSesionActiva } from '../../data/useAmbito';
import type { RolConteo } from '../../domain/types';

const ROLES: RolConteo[] = ['CONTEO_1', 'CONTEO_2', 'MUESTREO'];

export function SessionPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const repoVer = useRepo();
  useSesionActiva(id);
  const usuario = useUsuarioActual();
  const sesion = repo.sesion(id);
  const [nuevaUbic, setNuevaUbic] = useState('');

  const uid = usuario?.id;
  useEffect(() => {
    if (!id || !uid) return;
    const rg = repo.usuario(uid)?.rolGlobal;
    if (rg !== 'ADMIN' && rg !== 'AUDITOR') return;
    const n = purgarMiembrosHuerfanos(id);
    if (n > 0) toast(`Se limpiaron ${n} asignación(es) de sesión inválida(s)`);
  }, [id, uid, repoVer]);

  if (!sesion || !usuario) return <p>Sesión no encontrada.</p>;

  const viewer = viewerDeSesion(id, usuario.id);
  const priv = viewer.rolGlobal === 'ADMIN' || viewer.rolGlobal === 'AUDITOR';
  const prog = progresoSesion(id);
  const miembros = repo.miembrosDeSesion(id);
  const alertas = repo.alertasDeSesion(id);
  const abiertas = alertas.filter((a) => !a.atendida);

  const miRol = viewer.rolConteo;

  return (
    <>
      <div className="row between">
        <div>
          <h1>{sesion.nombre}</h1>
          <p className="lead" style={{ margin: 0 }}>
            {sesion.estado} · umbral de alerta {Math.round(sesion.umbralDiscrepancia * 100)}% ·
            tu rol: {miRol ?? viewer.rolGlobal}
          </p>
        </div>
        <button className="ghost" onClick={() => nav('/sesiones')}>
          ← Sesiones
        </button>
      </div>

      <div className="row" style={{ margin: '1rem 0' }}>
        {miRol && sesion.estado === 'ACTIVO' && (
          <button className="primary" onClick={() => nav(`/sesiones/${id}/contar`)}>
            Escanear y contar ({miRol})
          </button>
        )}
        <button onClick={() => nav(`/sesiones/${id}/consolidado`)}>
          Ver consolidado
        </button>
        {viewer.rolGlobal === 'ADMIN' && sesion.estado === 'ACTIVO' && (
          <button
            className="danger"
            onClick={() => {
              if (confirm('¿Cerrar la sesión? Ya no se podrán registrar conteos.')) {
                cerrarSesion(id);
                toast('Sesión cerrada');
              }
            }}
          >
            Cerrar sesión
          </button>
        )}
        {viewer.rolGlobal === 'ADMIN' && (
          <button
            className="danger"
            onClick={() => {
              const n = repo.conteosDeSesion(id).length;
              if (
                prompt(
                  `Esto ELIMINA la sesión "${sesion.nombre}" y sus ${n} conteos, ` +
                    `miembros y alertas. Escribe ELIMINAR para confirmar.`,
                ) === 'ELIMINAR'
              ) {
                eliminarSesion(id);
                toast('Sesión eliminada');
                nav('/sesiones');
              }
            }}
          >
            Eliminar sesión
          </button>
        )}
      </div>

      <h2>Progreso</h2>
      <div className="stat">
        <div>
          <div className="n">{prog.totalLotesConQr}</div>
          <div className="l">lotes con QR</div>
        </div>
        <div>
          <div className="n">{prog.conteo1}</div>
          <div className="l">con CONTEO 1</div>
        </div>
        <div>
          <div className="n">{prog.conteo2}</div>
          <div className="l">con CONTEO 2</div>
        </div>
        <div>
          <div className="n">{prog.coinciden}</div>
          <div className="l">coinciden</div>
        </div>
        <div>
          <div className="n" style={{ color: prog.discrepancias ? 'var(--danger)' : undefined }}>
            {prog.discrepancias}
          </div>
          <div className="l">en discrepancia</div>
        </div>
        <div>
          <div className="n">{prog.auditados}</div>
          <div className="l">auditados (P3)</div>
        </div>
      </div>

      {priv && (
        <>
          <h2>Alertas para el auditor {abiertas.length > 0 && <span className="badge danger">{abiertas.length}</span>}</h2>
          {alertas.length === 0 ? (
            <p className="muted">Sin alertas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Detalle</th>
                    <th>Lote</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alertas.map((a) => {
                    const lote = repo.lotesActivos().find((l) => l.id === a.loteId);
                    return (
                      <tr key={a.id}>
                        <td>{new Date(a.fechaCreacion).toLocaleString()}</td>
                        <td>
                          <span className={'badge ' + (a.atendida ? 'muted' : 'danger')}>
                            {a.tipo.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{a.detalle}</td>
                        <td>
                          {lote
                            ? `${lote.codigoProducto} · ${lote.lote}`
                            : a.loteId.slice(0, 8)}
                        </td>
                        <td>
                          {!a.atendida && (
                            <button
                              className="sm"
                              onClick={() => {
                                atenderAlerta(a.id);
                                toast('Alerta marcada como atendida');
                              }}
                            >
                              Atender
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {viewer.rolGlobal === 'ADMIN' && (
        <>
          <h2>Equipo de la sesión</h2>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol global</th>
                  <th>Rol en esta sesión</th>
                </tr>
              </thead>
              <tbody>
                {repo.usuarios().map((u) => {
                  const m = miembros.find((x) => x.usuarioId === u.id);
                  return (
                    <tr key={u.id}>
                      <td>{u.nombre}</td>
                      <td>{u.rolGlobal}</td>
                      <td>
                        <select
                          value={m?.rol ?? ''}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            asignarMiembro(id, u.id, e.target.value as RolConteo);
                            toast(`${u.nombre} → ${e.target.value}`);
                          }}
                          style={{ maxWidth: 160 }}
                        >
                          <option value="">— sin asignar —</option>
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

          <h2>Ubicaciones</h2>
          <div className="row">
            <input
              type="text"
              placeholder="Ej. Bodega Central - Estante A3"
              value={nuevaUbic}
              onChange={(e) => setNuevaUbic(e.target.value)}
              style={{ maxWidth: 320 }}
            />
            <button
              onClick={() => {
                if (!nuevaUbic.trim()) return;
                crearUbicacion(nuevaUbic.trim());
                setNuevaUbic('');
                toast('Ubicación agregada');
              }}
            >
              Agregar
            </button>
          </div>
          <ul>
            {repo.ubicaciones().map((u) => (
              <li key={u.id}>{u.nombre}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
