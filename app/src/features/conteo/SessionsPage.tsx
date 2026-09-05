import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../components/toast';
import { useUsuarioActual } from '../../auth/firebaseAuth';
import { repo } from '../../data/repo';
import {
  UMBRAL_DISCREPANCIA_DEFAULT,
  crearSesion,
} from '../../data/conteoService';
import { useRepo } from '../../data/useRepo';
import { hayDatosDemo, sembrarDemo } from '../../data/seed';
import { MUESTRAS, hayLotesDeMuestra, sembrarLotesDeMuestra } from '../../data/muestras';
import type { RolConteo, SesionInventario } from '../../domain/types';

function TablaSesiones({ lista }: { lista: SesionInventario[] }) {
  const nav = useNavigate();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Inicio</th>
            <th>Estado</th>
            <th>Umbral</th>
            <th>Productos</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lista.map((s) => {
            const imp = s.importacionId ? repo.importacion(s.importacionId) : undefined;
            return (
              <tr key={s.id}>
                <td>{s.nombre}</td>
                <td>{new Date(s.fechaInicio).toLocaleDateString()}</td>
                <td>
                  <span className={'badge ' + (s.estado === 'ACTIVO' ? 'ok' : 'muted')}>
                    {s.estado}
                  </span>
                </td>
                <td>{Math.round(s.umbralDiscrepancia * 100)}%</td>
                <td>
                  {imp ? (
                    imp.nombreArchivo
                  ) : s.importacionId ? (
                    <span className="muted">importación pendiente</span>
                  ) : (
                    <span className="muted">sin definir</span>
                  )}
                </td>
                <td>
                  <button className="sm" onClick={() => nav(`/sesiones/${s.id}`)}>
                    Abrir
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SessionsPage() {
  useRepo();
  const nav = useNavigate();
  const usuario = useUsuarioActual();
  const [nombre, setNombre] = useState('');
  const [umbral, setUmbral] = useState(UMBRAL_DISCREPANCIA_DEFAULT * 100);
  const [importacionId, setImportacionId] = useState('');
  const sesiones = repo.sesiones();
  const esAdmin = usuario?.rolGlobal === 'ADMIN';
  const importacionesConfirmadas = repo
    .importaciones()
    .filter((i) => i.estado === 'CONFIRMADA');

  function crear() {
    if (!nombre.trim()) return;
    const s = crearSesion(
      nombre.trim(),
      Math.max(1, umbral) / 100,
      importacionId || undefined,
    );
    toast('Sesión creada');
    setNombre('');
    setImportacionId('');
    nav(`/sesiones/${s.id}`);
  }

  // Sesiones donde el usuario tiene un rol de conteo asignado.
  const misAsignaciones: { sesion: SesionInventario; rol: RolConteo }[] = usuario
    ? repo
        .miembrosDeUsuario(usuario.id)
        .flatMap((m) => {
          const s = repo.sesion(m.sesionId);
          return s ? [{ sesion: s, rol: m.rol }] : [];
        })
        .sort((a, b) => b.sesion.fechaInicio.localeCompare(a.sesion.fechaInicio))
    : [];
  const idsAsignadas = new Set(misAsignaciones.map((x) => x.sesion.id));
  const otrasSesiones = sesiones.filter((s) => !idsAsignadas.has(s.id));

  return (
    <>
      <h1>Sesiones de inventario</h1>
      <p className="lead">
        Cada sesión agrupa los conteos de una jornada. La triangulación y el stock
        oficial se calculan por sesión.
      </p>

      {esAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Nueva sesión</h2>
          <div className="row">
            <input
              type="text"
              placeholder="Nombre (ej. Inventario Bodega Central · Sep 2026)"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={{ maxWidth: 420 }}
            />
            <label style={{ maxWidth: 200 }}>
              Umbral de alerta (%)
              <input
                type="text"
                inputMode="numeric"
                value={umbral}
                onChange={(e) => setUmbral(Number(e.target.value) || 0)}
              />
            </label>
            {importacionesConfirmadas.length > 0 && (
              <label style={{ maxWidth: 280 }}>
                Productos (importación)
                <select
                  value={importacionId}
                  onChange={(e) => setImportacionId(e.target.value)}
                >
                  <option value="">— definir dentro de la sesión —</option>
                  {importacionesConfirmadas.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombreArchivo}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="primary"
              onClick={crear}
              style={{ alignSelf: 'flex-end' }}
            >
              Crear
            </button>
          </div>
          <p className="muted" style={{ fontSize: '.82rem', margin: '.5rem 0 0' }}>
            La lista de productos de la sesión se toma de una importación de PDF.
            Puedes elegirla aquí o importarla desde la propia sesión.
          </p>
          <div className="row" style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <span className="muted" style={{ fontSize: '.82rem' }}>Demo:</span>
            <button
              className="sm"
              disabled={hayDatosDemo()}
              onClick={() => {
                const s = sembrarDemo();
                toast('Datos de demostración cargados');
                nav(`/sesiones/${s.id}`);
              }}
            >
              Cargar datos de demostración
            </button>
            <button
              className="sm"
              disabled={hayLotesDeMuestra()}
              onClick={() => {
                const n = sembrarLotesDeMuestra();
                toast(
                  n === 0
                    ? 'Los lotes de muestra ya estaban cargados'
                    : `${n} lotes de muestra añadidos al catálogo`,
                );
              }}
              title={`Crea los ${MUESTRAS.length} productos/lotes de la carpeta muestras/`}
            >
              Cargar {MUESTRAS.length} lotes de muestra
            </button>
            <button
              className="sm danger"
              onClick={() => {
                if (confirm('¿Borrar TODOS los datos locales (catálogo, sesiones, conteos, etiquetas)?')) {
                  repo.reset();
                  localStorage.removeItem('qr-inventarios/servidor-demo/v1');
                  toast('Datos borrados');
                }
              }}
            >
              Borrar todo
            </button>
          </div>
        </div>
      )}

      {esAdmin ? (
        sesiones.length === 0 ? (
          <p className="muted">No hay sesiones todavía.</p>
        ) : (
          <TablaSesiones lista={sesiones} />
        )
      ) : (
        <>
          <h2>Mis sesiones asignadas</h2>
          {misAsignaciones.length === 0 ? (
            <p className="badge warn" style={{ display: 'block' }}>
              Aún no tienes una sesión asignada. Un administrador debe asignarte un
              rol de conteo (CONTEO 1, CONTEO 2 o MUESTREO).
            </p>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', gap: '.75rem' }}>
              {misAsignaciones.map(({ sesion: s, rol }) => (
                <div
                  key={s.id}
                  className="card"
                  style={{ minWidth: 260, flex: '1 1 260px' }}
                >
                  <h3 style={{ margin: '0 0 .25rem' }}>{s.nombre}</h3>
                  <p className="muted" style={{ margin: '0 0 .75rem' }}>
                    <span className="badge ok">{rol.replace(/_/g, ' ')}</span>{' '}
                    <span
                      className={'badge ' + (s.estado === 'ACTIVO' ? 'ok' : 'muted')}
                    >
                      {s.estado}
                    </span>
                  </p>
                  <div className="row">
                    {s.estado === 'ACTIVO' && (
                      <button
                        className="primary sm"
                        onClick={() => nav(`/sesiones/${s.id}/contar`)}
                      >
                        Escanear y contar
                      </button>
                    )}
                    <button className="sm" onClick={() => nav(`/sesiones/${s.id}`)}>
                      Ver sesión
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {otrasSesiones.length > 0 && (
            <details style={{ marginTop: '1.5rem' }}>
              <summary className="muted">
                Otras sesiones ({otrasSesiones.length})
              </summary>
              <div style={{ marginTop: '.75rem' }}>
                <TablaSesiones lista={otrasSesiones} />
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}
