import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from '../../components/toast';
import { enLote, repo } from '../../data/repo';
import {
  confirmarImportacion,
  descartarImportacion,
} from '../../data/service';
import { vincularImportacion } from '../../data/conteoService';
import { useRepo } from '../../data/useRepo';
import { useImportacionActiva } from '../../data/useAmbito';
import type { ImportacionFila } from '../../domain/types';

const LIMITE_RENDER = 250;

export function PreviewPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const sesionId = params.get('sesion') || '';
  const v = useRepo();
  useImportacionActiva(id);
  const imp = repo.importacion(id);
  const [filas, setFilas] = useState<ImportacionFila[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    setFilas(repo.filasDe(id));
  }, [id]);
  // Mientras no haya filas locales, adóptalas cuando lleguen (p. ej. por Firestore).
  useEffect(() => {
    setFilas((prev) => (prev.length === 0 ? repo.filasDe(id) : prev));
  }, [id, v]);
  const readOnly = imp?.estado !== 'PENDIENTE_REVISION';

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return filas;
    return filas.filter(
      (f) =>
        f.codigoExtraido.toLowerCase().includes(t) ||
        f.nombreExtraido.toLowerCase().includes(t),
    );
  }, [filas, q]);

  if (!imp) return <p>Importación no encontrada.</p>;

  const validas = filas.filter((f) => f.filaValida).length;
  const conQr = filas.filter((f) => f.filaValida && f.requiereQr).length;

  function editar(id: string, patch: Partial<ImportacionFila>) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function marcarTodasQr(valor: boolean) {
    setFilas((prev) =>
      prev.map((f) =>
        filtradas.some((x) => x.id === f.id) ? { ...f, requiereQr: valor } : f,
      ),
    );
  }

  function persistir() {
    enLote(() => {
      for (const f of filas) repo.actualizarFila(f);
    });
  }

  function confirmar() {
    persistir();
    const r = confirmarImportacion(id);
    toast(
      `Importación confirmada · ${r.productosCreados} productos y ${r.lotesCreados} lotes nuevos`,
    );
    if (sesionId && repo.sesion(sesionId)) {
      vincularImportacion(sesionId, id);
      nav(`/sesiones/${sesionId}`);
    } else {
      nav('/generar');
    }
  }

  function descartar() {
    if (!confirm('¿Descartar esta importación? No se tocará el catálogo.')) return;
    descartarImportacion(id);
    toast('Importación descartada');
    nav(sesionId && repo.sesion(sesionId) ? `/sesiones/${sesionId}` : '/importar');
  }

  return (
    <>
      <div className="row between">
        <h1>Previsualización: {imp.nombreArchivo}</h1>
        <button
          className="ghost"
          onClick={() =>
            nav(sesionId && repo.sesion(sesionId) ? `/sesiones/${sesionId}` : '/importar')
          }
        >
          ← Volver
        </button>
      </div>

      <div className="stat">
        <div>
          <div className="n">{filas.length}</div>
          <div className="l">filas extraídas</div>
        </div>
        <div>
          <div className="n">{validas}</div>
          <div className="l">válidas para confirmar</div>
        </div>
        <div>
          <div className="n">{conQr}</div>
          <div className="l">requieren QR</div>
        </div>
      </div>

      {!readOnly && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Corrige códigos o nombres mal leídos, completa lote y vencimiento si
            aplica, y desmarca las filas que <strong>no</strong> requieren QR
            (artículos a granel, insumos que no se auditan individualmente).
          </p>
          <div className="row">
            <button className="sm" onClick={() => marcarTodasQr(true)}>
              Marcar visibles: requieren QR
            </button>
            <button className="sm" onClick={() => marcarTodasQr(false)}>
              Marcar visibles: sin QR
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: '.75rem' }}>
        <input
          type="text"
          placeholder="Filtrar por código o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 340 }}
        />
        <span className="muted">
          {filtradas.length} de {filas.length}
          {filtradas.length > LIMITE_RENDER
            ? ` · mostrando ${LIMITE_RENDER}`
            : ''}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>QR</th>
              <th style={{ width: 40 }}>OK</th>
              <th>Código</th>
              <th>Nombre</th>
              <th style={{ width: 70 }}>Pres.</th>
              <th style={{ width: 120 }}>Lote</th>
              <th style={{ width: 140 }}>Vence</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.slice(0, LIMITE_RENDER).map((f) => (
              <tr key={f.id} className={f.filaValida ? '' : 'invalida'}>
                <td>
                  <input
                    type="checkbox"
                    checked={f.requiereQr}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { requiereQr: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={f.filaValida}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { filaValida: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={f.codigoExtraido}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { codigoExtraido: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={f.nombreExtraido}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { nombreExtraido: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={f.presentacionExtraida ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { presentacionExtraida: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="—"
                    value={f.loteExtraido ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { loteExtraido: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={f.vencimientoExtraido ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      editar(f.id, { vencimientoExtraido: e.target.value })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="primary" onClick={confirmar} disabled={validas === 0}>
            Confirmar {validas} filas contra el catálogo
          </button>
          <button onClick={persistir}>Guardar cambios</button>
          <div className="spacer" />
          <button className="danger" onClick={descartar}>
            Descartar importación
          </button>
        </div>
      )}
      {readOnly && (
        <p className="muted" style={{ marginTop: '1rem' }}>
          Esta importación está {imp.estado === 'CONFIRMADA' ? 'confirmada' : 'descartada'};
          la tabla es de solo lectura.
        </p>
      )}
    </>
  );
}
