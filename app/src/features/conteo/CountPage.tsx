import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../components/toast';
import { QrScanner, soportaEscaneoCamara } from '../../components/QrScanner';
import { useUsuarioActual } from '../../auth/firebaseAuth';
import { ahora, repo, uuid } from '../../data/repo';
import {
  idsVigentes,
  registrarConteo,
  ubicacionesSugeridas,
  viewerDeSesion,
} from '../../data/conteoService';
import { useRepo } from '../../data/useRepo';
import { useSesionActiva } from '../../data/useAmbito';
import { parsePayload } from '../../lib/qr/payload';
import type { Conteo, Lote } from '../../domain/types';

type Objetivo =
  | { tipo: 'lote'; lote: Lote; escaneado: boolean }
  | { tipo: 'desconocido'; payloadCrudo: string };

export function CountPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const v = useRepo();
  useSesionActiva(id);
  const usuario = useUsuarioActual();
  const sesion = repo.sesion(id);

  const [modo, setModo] = useState<'scan' | 'manual'>(
    soportaEscaneoCamara() ? 'scan' : 'manual',
  );
  const [q, setQ] = useState('');
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [corrigiendo, setCorrigiendo] = useState<{ id: string; previa: number } | null>(
    null,
  );
  const [nuevo, setNuevo] = useState({ codigo: '', nombre: '', lote: '—' });

  const viewer = usuario ? viewerDeSesion(id, usuario.id) : null;

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return repo
      .lotesActivos()
      .map((l) => ({ lote: l, producto: repo.producto(l.codigoProducto) }))
      .filter(
        ({ lote, producto }) =>
          lote.codigoProducto.toLowerCase().includes(t) ||
          producto?.nombre.toLowerCase().includes(t) ||
          lote.lote.toLowerCase().includes(t),
      )
      .slice(0, 15);
  }, [q, v]);

  const misConteos = useMemo(() => {
    if (!viewer) return [];
    return repo
      .conteosDeSesion(id)
      .filter((c) => c.rolConteo === viewer.rolConteo)
      .sort((a, b) =>
        (b.fechaSync ?? b.fechaRegistroLocal).localeCompare(
          a.fechaSync ?? a.fechaRegistroLocal,
        ),
      )
      .slice(0, 8);
  }, [id, v, viewer]);

  const vigentes = useMemo(() => idsVigentes(id), [id, v]);
  const sugerencias = useMemo(() => ubicacionesSugeridas(id), [id, v]);

  if (!sesion || !usuario || !viewer) return <p>Sesión no encontrada.</p>;
  if (!viewer.rolConteo)
    return (
      <p className="badge warn" style={{ display: 'block' }}>
        No tienes un rol de conteo asignado en esta sesión. Pídelo a un Admin.
      </p>
    );
  if (sesion.estado === 'CERRADO')
    return <p className="badge muted" style={{ display: 'block' }}>La sesión está cerrada.</p>;

  function elegirLote(lote: Lote, escaneado: boolean) {
    setObjetivo({ tipo: 'lote', lote, escaneado });
    setCantidad('');
    setCorrigiendo(null);
    setQ('');
  }

  function corregirConteo(c: Conteo) {
    const lote = repo.lotesActivos().find((l) => l.id === c.loteId);
    if (!lote) {
      toast('Ese lote ya no está en el catálogo');
      return;
    }
    setObjetivo({ tipo: 'lote', lote, escaneado: false });
    setCantidad(String(c.cantidad));
    setUbicacion(c.ubicacion ?? '');
    setCorrigiendo({ id: c.id, previa: c.cantidad });
    setQ('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onDetectado(texto: string) {
    const payload = parsePayload(texto);
    if (payload) {
      const lote = repo.lotesActivos().find((l) => l.id === payload.lid);
      if (lote) {
        elegirLote(lote, true);
        return;
      }
    }
    // QR no reconocido (spec 4): nunca se bloquea al operador
    setObjetivo({ tipo: 'desconocido', payloadCrudo: texto });
  }

  function registrarNuevoYContar() {
    const codigo = nuevo.codigo.trim();
    if (!codigo || !nuevo.nombre.trim()) {
      toast('Código y nombre son obligatorios');
      return;
    }
    if (!repo.producto(codigo)) {
      repo.upsertProducto({ codigo, nombre: nuevo.nombre.trim(), createdAt: ahora() });
    }
    const lote: Lote = {
      id: uuid(),
      codigoProducto: codigo,
      lote: nuevo.lote.trim() || '—',
      requiereQr: true,
      activo: true,
      createdAt: ahora(),
    };
    repo.upsertLote(lote);
    toast('Producto y lote registrados');
    elegirLote(lote, false);
  }

  function guardar() {
    if (objetivo?.tipo !== 'lote' || !usuario || !viewer?.rolConteo) return;
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 0) {
      toast('Cantidad inválida');
      return;
    }
    const ubic = ubicacion.trim();
    const ubicMatch = repo
      .ubicaciones()
      .find((u) => u.nombre.trim().toLowerCase() === ubic.toLowerCase());
    try {
      const r = registrarConteo({
        sesionId: id,
        loteId: objetivo.lote.id,
        ubicacion: ubic || undefined,
        ubicacionId: ubicMatch?.id,
        usuarioId: usuario.id,
        rolConteo: viewer.rolConteo!,
        cantidad: n,
        ingresoManual: !objetivo.escaneado,
        corrigeConteoId: corrigiendo?.id,
      });
      toast(
        r.duplicado
          ? 'Ese conteo ya estaba registrado'
          : corrigiendo
            ? `Conteo corregido: ${corrigiendo.previa} → ${n}`
            : `Conteo guardado: ${n}` +
              (r.alertas.length ? ' · generó alerta al auditor' : ''),
      );
      setObjetivo(null);
      setCantidad('');
      setCorrigiendo(null);
    } catch (e) {
      toast('Error: ' + (e as Error).message);
    }
  }

  const producto =
    objetivo?.tipo === 'lote'
      ? repo.producto(objetivo.lote.codigoProducto)
      : undefined;

  return (
    <>
      <div className="row between">
        <h1>Contar · {viewer.rolConteo}</h1>
        <button className="ghost" onClick={() => nav(`/sesiones/${id}`)}>
          ← Sesión
        </button>
      </div>
      <p className="lead">{sesion.nombre}</p>

      {!objetivo && (
        <>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button
              className={modo === 'scan' ? 'primary' : ''}
              onClick={() => setModo('scan')}
            >
              Escanear QR
            </button>
            <button
              className={modo === 'manual' ? 'primary' : ''}
              onClick={() => setModo('manual')}
            >
              Búsqueda manual
            </button>
          </div>

          {modo === 'scan' && (
            <QrScanner activo onDetectado={onDetectado} />
          )}

          {modo === 'manual' && (
            <>
              <input
                type="text"
                placeholder="Código, nombre o lote…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 420 }}
                autoFocus
              />
              {resultados.length > 0 && (
                <div className="table-wrap" style={{ marginTop: '.75rem' }}>
                  <table>
                    <tbody>
                      {resultados.map(({ lote, producto }) => (
                        <tr key={lote.id}>
                          <td>{lote.codigoProducto}</td>
                          <td>{producto?.nombre ?? '—'}</td>
                          <td>{lote.lote}</td>
                          <td>
                            <button
                              className="sm"
                              onClick={() => elegirLote(lote, false)}
                            >
                              Contar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {objetivo?.tipo === 'desconocido' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>QR no reconocido</h2>
          <p className="muted">
            Contenido leído: <code className="inline">{objetivo.payloadCrudo.slice(0, 120)}</code>
          </p>
          <p>Registra el producto ahora para no frenar el conteo (spec §4):</p>
          <div className="row">
            <input
              type="text"
              placeholder="Código"
              value={nuevo.codigo}
              onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
              style={{ maxWidth: 160 }}
            />
            <input
              type="text"
              placeholder="Nombre"
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              style={{ maxWidth: 260 }}
            />
            <input
              type="text"
              placeholder="Lote"
              value={nuevo.lote}
              onChange={(e) => setNuevo({ ...nuevo, lote: e.target.value })}
              style={{ maxWidth: 120 }}
            />
          </div>
          <div className="row" style={{ marginTop: '.75rem' }}>
            <button className="primary" onClick={registrarNuevoYContar}>
              Registrar y contar
            </button>
            <button onClick={() => setObjetivo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {objetivo?.tipo === 'lote' && (
        <div className="card">
          {corrigiendo && (
            <p className="badge warn" style={{ display: 'block' }}>
              Corrigiendo un conteo anterior de {corrigiendo.previa}. Se guarda una
              versión nueva y la anterior queda marcada como reemplazada
              (trazabilidad).
            </p>
          )}
          <h2 style={{ marginTop: 0 }}>{producto?.nombre ?? objetivo.lote.codigoProducto}</h2>
          <p className="muted">
            <code className="inline">{objetivo.lote.codigoProducto}</code> · Lote{' '}
            {objetivo.lote.lote}
            {objetivo.lote.fechaVencimiento
              ? ` · Vence ${objetivo.lote.fechaVencimiento}`
              : ''}{' '}
            ·{' '}
            {objetivo.escaneado ? (
              <span className="badge ok">escaneado</span>
            ) : (
              <span className="badge warn">ingreso manual</span>
            )}
          </p>

          <div className="row" style={{ marginTop: '.5rem' }}>
            <label style={{ maxWidth: 160 }}>
              Cantidad
              <input
                type="text"
                inputMode="numeric"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value.replace(/[^\d]/g, ''))}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && guardar()}
              />
            </label>
            <label style={{ maxWidth: 240 }}>
              Ubicación (opcional)
              <input
                type="text"
                list="ubic-sugeridas"
                placeholder="Ej. Cámara 1, Despacho…"
                value={ubicacion}
                onChange={(e) => setUbicacion(e.target.value)}
              />
              <datalist id="ubic-sugeridas">
                {sugerencias.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <button
              className="primary"
              onClick={guardar}
              style={{ alignSelf: 'flex-end' }}
            >
              {corrigiendo ? 'Guardar corrección' : 'Guardar conteo'}
            </button>
            <button
              onClick={() => {
                setObjetivo(null);
                setCorrigiendo(null);
              }}
              style={{ alignSelf: 'flex-end' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <h2>Mis últimos conteos</h2>
      {misConteos.length === 0 ? (
        <p className="muted">Aún no has registrado conteos en esta sesión.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Producto</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {misConteos.map((c) => {
              const lote = repo.lotesActivos().find((l) => l.id === c.loteId);
              const vigente = vigentes.has(c.id);
              return (
                <tr key={c.id}>
                  <td>{new Date(c.fechaSync ?? c.fechaRegistroLocal).toLocaleTimeString()}</td>
                  <td>{lote ? repo.producto(lote.codigoProducto)?.nombre : '—'}</td>
                  <td>{lote?.lote ?? '—'}</td>
                  <td>
                    {c.cantidad}
                    {c.ingresoManual && <span className="badge warn"> manual</span>}
                    {c.corrigeConteoId && <span className="badge muted"> corrección</span>}
                  </td>
                  <td>{c.ubicacion ?? '—'}</td>
                  <td>
                    {!vigente ? (
                      <span className="badge muted">reemplazado</span>
                    ) : c.estadoSync === 'PENDIENTE' ? (
                      <span className="badge warn">pendiente de sincronizar</span>
                    ) : (
                      <span className="badge ok">sincronizado</span>
                    )}
                  </td>
                  <td>
                    {vigente && sesion.estado === 'ACTIVO' && lote && (
                      <button className="sm" onClick={() => corregirConteo(c)}>
                        Corregir
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
