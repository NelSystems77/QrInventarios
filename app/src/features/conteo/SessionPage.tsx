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
  guardarStockSifa,
  lotesDeSesion,
  progresoSesion,
  purgarMiembrosHuerfanos,
  viewerDeSesion,
} from '../../data/conteoService';
import { parsePharmacyPdf } from '../../lib/pdf/parsePharmacyPdf';
import { useRepo } from '../../data/useRepo';
import { useSesionActiva } from '../../data/useAmbito';
import type { Lote, RolConteo } from '../../domain/types';

/**
 * Lotes con QR que aún no tienen etiqueta impresa. Inline aquí (en vez de importar
 * `lotesPendientesDeImpresion` de `data/service`) para no arrastrar pdf-lib/qrcode
 * al bundle inicial: `SessionPage` no es lazy.
 */
function lotesSinEtiqueta(lotes: Lote[]): Lote[] {
  return lotes.filter((l) => {
    if (!l.activo || !l.requiereQr) return false;
    const et = repo.etiquetaDeLote(l.id);
    return !et || et.vecesImpreso === 0;
  });
}

const ROLES: RolConteo[] = ['CONTEO_1', 'CONTEO_2', 'MUESTREO'];

export function SessionPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const repoVer = useRepo();
  useSesionActiva(id);
  const usuario = useUsuarioActual();
  const sesion = repo.sesion(id);
  const [nuevaUbic, setNuevaUbic] = useState('');
  const [cargandoSifa, setCargandoSifa] = useState(false);
  const [cargandoPdf, setCargandoPdf] = useState(false);
  const [generandoQr, setGenerandoQr] = useState(false);

  async function importarPdfProductos(file: File) {
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      toast('El archivo debe ser un PDF.');
      return;
    }
    setCargandoPdf(true);
    try {
      const extraccion = await parsePharmacyPdf(await file.arrayBuffer());
      if (extraccion.filas.length === 0) {
        toast('No se detectaron filas de producto en el PDF.');
        return;
      }
      const { crearImportacionDesdeExtraccion } = await import('../../data/service');
      const imp = crearImportacionDesdeExtraccion(file.name, extraccion);
      toast(`${extraccion.filas.length} filas extraídas · revísalas y confirma`);
      nav(`/importar/${imp.id}?sesion=${id}`);
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el PDF: ' + (e as Error).message);
    } finally {
      setCargandoPdf(false);
    }
  }

  async function generarQrDeSesion() {
    if (!usuario) return;
    setGenerandoQr(true);
    try {
      const { generarPendientes, descargarPdf } = await import('../../data/service');
      const { pdf, cantidad } = await generarPendientes(
        usuario.id,
        lotesDeSesion(id),
      );
      if (cantidad === 0) {
        toast('No hay etiquetas pendientes en esta sesión.');
        return;
      }
      descargarPdf(
        pdf,
        `etiquetas-${(repo.sesion(id)?.nombre ?? 'sesion').replace(/\s+/g, '_')}.pdf`,
      );
      toast(`${cantidad} etiquetas generadas y marcadas como impresas.`);
    } catch (e) {
      console.error(e);
      toast('Error al generar: ' + (e as Error).message);
    } finally {
      setGenerandoQr(false);
    }
  }

  async function cargarSifa(file: File) {
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      toast('El archivo debe ser un PDF (reporte RptSIFA032).');
      return;
    }
    setCargandoSifa(true);
    try {
      const { filas } = await parsePharmacyPdf(await file.arrayBuffer());
      const conExistencia = filas.filter((f) => f.existencia !== undefined);
      if (conExistencia.length === 0) {
        toast('El PDF no trae la columna EXISTENCIA. ¿Es un reporte RptSIFA032?');
        return;
      }
      const r = guardarStockSifa(
        id,
        filas.map((f) => ({
          codigo: f.codigo,
          nombre: f.nombre,
          existencia: f.existencia,
        })),
        file.name,
      );
      toast(
        `Stock SIFA: ${r.guardados} existencias cargadas` +
          (r.ignorados ? ` · ${r.ignorados} códigos fuera del catálogo` : '') +
          (r.sinExistencia ? ` · ${r.sinExistencia} filas sin existencia` : ''),
      );
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el PDF: ' + (e as Error).message);
    } finally {
      setCargandoSifa(false);
    }
  }

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
  const sinRol = !priv && !miRol;

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

      {sinRol && (
        <p className="badge warn" style={{ display: 'block', margin: '1rem 0' }}>
          Aún no tienes un rol de conteo asignado en esta sesión. Un administrador
          debe asignarte CONTEO 1, CONTEO 2 o MUESTREO para que puedas contar.
        </p>
      )}

      <div className="row" style={{ margin: '1rem 0' }}>
        {miRol && sesion.estado === 'ACTIVO' && (
          <button className="primary" onClick={() => nav(`/sesiones/${id}/contar`)}>
            Escanear y contar ({miRol})
          </button>
        )}
        {!sinRol && (
          <button onClick={() => nav(`/sesiones/${id}/consolidado`)}>
            Ver consolidado
          </button>
        )}
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

      {viewer.rolGlobal === 'ADMIN' && sesion.estado === 'ACTIVO' && (() => {
        const imp = sesion.importacionId
          ? repo.importacion(sesion.importacionId)
          : undefined;
        const lotesSes = lotesDeSesion(id);
        const conQr = lotesSes.filter((l) => l.requiereQr);
        const pendientesEtq = lotesSinEtiqueta(lotesSes);
        const nMiembros = miembros.length;
        const paso = (ok: boolean) => (
          <span className={'badge ' + (ok ? 'ok' : 'warn')}>{ok ? '✓' : '•'}</span>
        );
        return (
          <>
            <h2>Preparación de la sesión</h2>
            <div className="card">
              <ol style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.9 }}>
                <li>
                  {paso(!!imp)} <strong>Productos.</strong>{' '}
                  {imp ? (
                    <>
                      {imp.nombreArchivo} · {lotesSes.length} lotes ({conQr.length} con
                      QR).{' '}
                      <button className="sm" onClick={() => nav('/catalogo')}>
                        Ajustar exclusiones
                      </button>
                    </>
                  ) : sesion.importacionId ? (
                    <span className="muted">
                      Importación vinculada pero aún sin confirmar.
                    </span>
                  ) : (
                    <>
                      <span className="muted">
                        Importa el PDF de productos de esta bodega.{' '}
                      </span>
                      <button
                        className="primary sm"
                        type="button"
                        disabled={cargandoPdf}
                        onClick={(e) =>
                          (
                            e.currentTarget.nextElementSibling as HTMLInputElement
                          )?.click()
                        }
                      >
                        {cargandoPdf ? 'Procesando…' : 'Importar PDF de productos'}
                      </button>
                      <input
                        type="file"
                        accept="application/pdf"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importarPdfProductos(f);
                          e.target.value = '';
                        }}
                      />
                    </>
                  )}
                </li>
                <li>
                  {paso(imp ? pendientesEtq.length === 0 : false)}{' '}
                  <strong>Etiquetas QR.</strong>{' '}
                  {!imp ? (
                    <span className="muted">Primero define los productos.</span>
                  ) : pendientesEtq.length === 0 ? (
                    <span className="muted">
                      Todas las etiquetas con QR ya están generadas.
                    </span>
                  ) : (
                    <>
                      <span className="muted">
                        {pendientesEtq.length} lotes sin etiqueta impresa.{' '}
                      </span>
                      <button
                        className="primary sm"
                        onClick={generarQrDeSesion}
                        disabled={generandoQr}
                      >
                        {generandoQr ? 'Generando…' : 'Generar hoja de QR'}
                      </button>
                    </>
                  )}
                </li>
                <li>
                  {paso(nMiembros > 0)} <strong>Equipo.</strong>{' '}
                  <span className="muted">
                    {nMiembros === 0
                      ? 'Asigna CONTEO 1 / CONTEO 2 / MUESTREO en «Equipo de la sesión».'
                      : `${nMiembros} persona(s) asignada(s).`}
                  </span>
                </li>
                <li>
                  {paso(repo.stockSifaDeSesion(id).length > 0)}{' '}
                  <strong>Stock SIFA (opcional).</strong>{' '}
                  <span className="muted">
                    Carga el reporte RptSIFA032 para reconciliar en el consolidado.
                  </span>
                </li>
              </ol>
            </div>
          </>
        );
      })()}

      {!sinRol && (
        <>
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
        </>
      )}

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
          <h2>Stock SIFA (existencias del sistema)</h2>
          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>
              Sube el reporte <strong>RptSIFA032</strong>. Se toma la columna
              EXISTENCIA de cada código que forme parte de esta sesión y se compara
              contra el stock físico en el consolidado. Volver a subir un reporte
              reemplaza el anterior.
            </p>
            <div className="row">
              <span>
                <button
                  className="primary"
                  type="button"
                  disabled={cargandoSifa}
                  onClick={(e) => {
                    (e.currentTarget.nextElementSibling as HTMLInputElement)?.click();
                  }}
                >
                  {cargandoSifa ? 'Procesando…' : 'Cargar existencias (PDF)'}
                </button>
                <input
                  type="file"
                  accept="application/pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) cargarSifa(f);
                    e.target.value = '';
                  }}
                />
              </span>
              {(() => {
                const sifa = repo.stockSifaDeSesion(id);
                if (sifa.length === 0)
                  return <span className="muted">Sin existencias cargadas.</span>;
                const ult = sifa
                  .map((s) => s.fechaCarga)
                  .sort()
                  .at(-1);
                return (
                  <span className="muted">
                    {sifa.length} existencias
                    {sifa[0]?.archivo ? ` · ${sifa[0].archivo}` : ''}
                    {ult ? ` · ${new Date(ult).toLocaleString()}` : ''}
                  </span>
                );
              })()}
              {repo.stockSifaDeSesion(id).length > 0 && (
                <button
                  className="danger sm"
                  onClick={() => {
                    if (confirm('¿Borrar las existencias SIFA de esta sesión?')) {
                      repo.borrarStockSifaDeSesion(id);
                      toast('Existencias SIFA borradas');
                    }
                  }}
                >
                  Borrar
                </button>
              )}
            </div>
          </div>

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
          <p className="muted" style={{ marginTop: 0 }}>
            Sugerencias para el campo «Ubicación» del conteo (Ej. Cámara 1,
            Despacho). El contador también puede escribir una que no esté aquí.
          </p>
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
