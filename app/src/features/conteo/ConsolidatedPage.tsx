import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUsuarioActual } from '../../auth/firebaseAuth';
import { repo } from '../../data/repo';
import {
  consolidadoDeSesion,
  exportarConsolidadoCsv,
  exportarReconciliacionCsv,
  reconciliacionDeSesion,
  viewerDeSesion,
} from '../../data/conteoService';
import { useRepo } from '../../data/useRepo';
import { useSesionActiva } from '../../data/useAmbito';
import type { EstadoReconciliacion, EstadoTriangulacion } from '../../domain/types';

const BADGE: Record<EstadoTriangulacion, string> = {
  PENDIENTE: 'muted',
  COINCIDE: 'ok',
  DISCREPANCIA: 'danger',
  AUDITADO: 'warn',
};

const BADGE_RECON: Record<EstadoReconciliacion, string> = {
  CUADRA: 'ok',
  SOBRANTE: 'warn',
  FALTANTE: 'danger',
  PENDIENTE: 'muted',
  SIN_SIFA: 'muted',
};

const num = (n: number | null) =>
  n === null ? '·' : Number.isInteger(n) ? String(n) : n.toFixed(3);

export function ConsolidatedPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const v = useRepo();
  useSesionActiva(id);
  const usuario = useUsuarioActual();
  const sesion = repo.sesion(id);
  const [filtro, setFiltro] = useState<'movimiento' | 'todos' | EstadoTriangulacion>(
    'movimiento',
  );
  const [q, setQ] = useState('');
  const [vista, setVista] = useState<'lote' | 'reconciliacion'>('lote');

  const viewer = usuario ? viewerDeSesion(id, usuario.id) : null;
  const priv = viewer?.rolGlobal === 'ADMIN' || viewer?.rolGlobal === 'AUDITOR';

  const reconc = useMemo(() => {
    if (!viewer || !priv || vista !== 'reconciliacion') return [];
    let f = reconciliacionDeSesion(id, viewer);
    const t = q.trim().toLowerCase();
    if (t)
      f = f.filter(
        (x) =>
          x.codigo.toLowerCase().includes(t) ||
          x.nombre.toLowerCase().includes(t),
      );
    return f;
  }, [id, v, viewer, priv, vista, q]);

  const filas = useMemo(() => {
    if (!viewer) return [];
    let f = consolidadoDeSesion(id, viewer, {
      soloConMovimiento: filtro === 'movimiento',
    });
    if (filtro !== 'movimiento' && filtro !== 'todos') {
      f = f.filter((x) => x.estadoTriangulacion === filtro);
    }
    const t = q.trim().toLowerCase();
    if (t) {
      f = f.filter(
        (x) =>
          x.codigo.toLowerCase().includes(t) ||
          x.nombre.toLowerCase().includes(t),
      );
    }
    return f;
  }, [id, v, viewer, filtro, q]);

  if (!sesion || !viewer) return <p>Sesión no encontrada.</p>;

  const reconciliacion = vista === 'reconciliacion' && priv;

  function exportar() {
    const csv = reconciliacion
      ? exportarReconciliacionCsv(reconc)
      : exportarConsolidadoCsv(filas);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const prefijo = reconciliacion ? 'reconciliacion-sifa' : 'consolidado';
    a.href = url;
    a.download = `${prefijo}-${sesion!.nombre.replace(/\s+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="row between">
        <h1>Consolidado · {sesion.nombre}</h1>
        <button className="ghost" onClick={() => nav(`/sesiones/${id}`)}>
          ← Sesión
        </button>
      </div>
      {!priv && (
        <p className="badge warn" style={{ display: 'block' }}>
          Vista de contador: solo ves tu propia columna (blind count). La
          triangulación y el stock físico los ve Admin / Auditor.
        </p>
      )}

      {priv && (
        <div className="row" style={{ margin: '1rem 0 0' }}>
          <button
            className={vista === 'lote' ? 'primary' : 'ghost'}
            onClick={() => setVista('lote')}
          >
            Por lote
          </button>
          <button
            className={vista === 'reconciliacion' ? 'primary' : 'ghost'}
            onClick={() => setVista('reconciliacion')}
          >
            Stock SIFA vs físico
          </button>
        </div>
      )}

      <div className="row" style={{ margin: '1rem 0' }}>
        {!reconciliacion && (
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            style={{ maxWidth: 220 }}
          >
            <option value="movimiento">Con al menos un conteo</option>
            <option value="todos">Todos los lotes</option>
            <option value="COINCIDE">Solo COINCIDE</option>
            <option value="DISCREPANCIA">Solo DISCREPANCIA</option>
            <option value="AUDITADO">Solo AUDITADO</option>
            <option value="PENDIENTE">Solo PENDIENTE</option>
          </select>
        )}
        <input
          type="text"
          placeholder="Filtrar por código o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <span className="muted">
          {reconciliacion ? reconc.length : filas.length} filas
        </span>
        <div className="spacer" />
        <button
          onClick={exportar}
          disabled={reconciliacion ? reconc.length === 0 : filas.length === 0}
        >
          Exportar CSV
        </button>
      </div>

      {reconciliacion ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Stock SIFA</th>
                <th>Stock físico</th>
                <th>Diferencia</th>
                <th>Estado</th>
                <th>Lotes</th>
              </tr>
            </thead>
            <tbody>
              {reconc.slice(0, 1000).map((f) => (
                <tr key={f.codigo}>
                  <td>{f.codigo}</td>
                  <td>{f.nombre}</td>
                  <td>{num(f.stockSifa)}</td>
                  <td>{num(f.stockFisico)}</td>
                  <td
                    style={{
                      color:
                        f.diferencia && f.diferencia !== 0
                          ? 'var(--danger)'
                          : undefined,
                    }}
                  >
                    {f.diferencia === null
                      ? '·'
                      : (f.diferencia > 0 ? '+' : '') + num(f.diferencia)}
                  </td>
                  <td>
                    <span className={'badge ' + BADGE_RECON[f.estado]}>
                      {f.estado === 'SIN_SIFA'
                        ? 'sin SIFA'
                        : f.estado.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {f.lotesResueltos}/{f.lotesTotales}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Lote</th>
              <th>Vence</th>
              <th>C1</th>
              <th>C2</th>
              <th>P3</th>
              <th>Triangulación</th>
              <th>Stock físico</th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 500).map((f) => (
              <tr key={f.loteId}>
                <td>{f.codigo}</td>
                <td>{f.nombre}</td>
                <td>{f.lote}</td>
                <td>{f.fechaVencimiento ?? '—'}</td>
                <td>{f.cantidadP1 ?? '·'}</td>
                <td>{f.cantidadP2 ?? '·'}</td>
                <td>{f.cantidadP3 ?? '·'}</td>
                <td>
                  <span className={'badge ' + BADGE[f.estadoTriangulacion]}>
                    {f.estadoTriangulacion}
                  </span>
                </td>
                <td>
                  {f.stockOficial ?? (
                    <span className="badge muted">
                      {f.estadoStock === 'EN_DISPUTA' ? 'en disputa' : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
