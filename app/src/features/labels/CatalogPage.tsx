import { useMemo, useState } from 'react';
import { toast } from '../../components/toast';
import { repo } from '../../data/repo';
import { setRequiereQr } from '../../data/service';
import { useRepo } from '../../data/useRepo';

const LIMITE = 300;

export function CatalogPage() {
  const v = useRepo();
  const [q, setQ] = useState('');

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return repo
      .lotesActivos()
      .map((l) => ({ lote: l, producto: repo.producto(l.codigoProducto), etiqueta: repo.etiquetaDeLote(l.id) }))
      .filter(
        ({ lote, producto }) =>
          !t ||
          lote.codigoProducto.toLowerCase().includes(t) ||
          producto?.nombre.toLowerCase().includes(t),
      )
      .sort((a, b) => a.lote.codigoProducto.localeCompare(b.lote.codigoProducto));
  }, [q, v]);

  const total = repo.lotesActivos().length;
  const conQr = repo.lotesActivos().filter((l) => l.requiereQr).length;

  return (
    <>
      <h1>Catálogo y exclusiones de QR</h1>
      <p className="lead">
        Marca qué lotes requieren etiqueta QR. Al excluir un lote que ya tenía
        etiqueta impresa, la etiqueta se desactiva pero no se borra (trazabilidad).
      </p>

      <div className="stat">
        <div>
          <div className="n">{total}</div>
          <div className="l">lotes activos</div>
        </div>
        <div>
          <div className="n">{conQr}</div>
          <div className="l">requieren QR</div>
        </div>
        <div>
          <div className="n">{repo.etiquetas().filter((e) => e.activo && e.vecesImpreso > 0).length}</div>
          <div className="l">etiquetas impresas</div>
        </div>
      </div>

      {total === 0 ? (
        <p className="muted">
          No hay lotes todavía. Importa un PDF y confírmalo para poblar el catálogo.
        </p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <input
              type="text"
              placeholder="Filtrar por código o nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 340 }}
            />
            <span className="muted">
              {filas.length} lotes{filas.length > LIMITE ? ` · mostrando ${LIMITE}` : ''}
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>QR</th>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th style={{ width: 110 }}>Lote</th>
                  <th style={{ width: 120 }}>Vence</th>
                  <th style={{ width: 130 }}>Etiqueta</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, LIMITE).map(({ lote, producto, etiqueta }) => (
                  <tr key={lote.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={lote.requiereQr}
                        onChange={(e) => {
                          setRequiereQr(lote.id, e.target.checked);
                          toast(
                            e.target.checked
                              ? 'Lote incluido en generación de QR'
                              : 'Lote excluido de generación de QR',
                          );
                        }}
                      />
                    </td>
                    <td>{lote.codigoProducto}</td>
                    <td>{producto?.nombre ?? <span className="muted">—</span>}</td>
                    <td>{lote.lote}</td>
                    <td>{lote.fechaVencimiento ?? <span className="muted">—</span>}</td>
                    <td>
                      {!etiqueta || etiqueta.vecesImpreso === 0 ? (
                        <span className="badge muted">sin imprimir</span>
                      ) : etiqueta.activo ? (
                        <span className="badge ok">
                          impresa ×{etiqueta.vecesImpreso}
                        </span>
                      ) : (
                        <span className="badge danger">inactiva</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
