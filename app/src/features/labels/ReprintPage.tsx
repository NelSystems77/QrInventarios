import { useMemo, useState } from 'react';
import { toast } from '../../components/toast';
import { repo } from '../../data/repo';
import { descargarPdf, reimprimirLote } from '../../data/service';
import { useRepo } from '../../data/useRepo';
import type { MotivoImpresion } from '../../domain/types';

const MOTIVOS: { valor: MotivoImpresion; etiqueta: string }[] = [
  { valor: 'DANADA', etiqueta: 'Etiqueta dañada' },
  { valor: 'EXTRAVIADA', etiqueta: 'Etiqueta extraviada' },
  { valor: 'RE_ETIQUETADO', etiqueta: 'Re-etiquetado' },
  { valor: 'INICIAL', etiqueta: 'Primera impresión' },
];

export function ReprintPage() {
  const v = useRepo();
  const [q, setQ] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<MotivoImpresion>('DANADA');
  const [imprimiendo, setImprimiendo] = useState(false);

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
      .slice(0, 25);
  }, [q, v]);

  const loteSel = seleccion
    ? repo.lotesActivos().find((l) => l.id === seleccion)
    : null;
  const etiquetaSel = seleccion ? repo.etiquetaDeLote(seleccion) : null;
  const historial = etiquetaSel ? repo.historialDeEtiqueta(etiquetaSel.id) : [];

  async function reimprimir() {
    if (!seleccion) return;
    setImprimiendo(true);
    try {
      const pdf = await reimprimirLote(seleccion, motivo);
      descargarPdf(pdf, `etiqueta-${loteSel?.codigoProducto}.pdf`);
      toast('Etiqueta reimpresa. Motivo e historial registrados.');
    } catch (e) {
      toast('Error: ' + (e as Error).message);
    } finally {
      setImprimiendo(false);
    }
  }

  return (
    <>
      <h1>Reimprimir etiqueta individual</h1>
      <p className="lead">
        Busca un producto o lote por código, nombre o lote y reimprime solo esa
        etiqueta. Toda reimpresión exige un motivo explícito y queda en el historial.
      </p>

      <input
        type="text"
        placeholder="Buscar por código, nombre o lote…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ maxWidth: 420 }}
      />

      {resultados.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '.75rem' }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th style={{ width: 100 }}>Lote</th>
                <th style={{ width: 120 }}>Etiqueta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resultados.map(({ lote, producto }) => {
                const et = repo.etiquetaDeLote(lote.id);
                return (
                  <tr key={lote.id}>
                    <td>{lote.codigoProducto}</td>
                    <td>{producto?.nombre ?? '—'}</td>
                    <td>{lote.lote}</td>
                    <td>
                      {et && et.vecesImpreso > 0 ? (
                        <span className="badge ok">×{et.vecesImpreso}</span>
                      ) : (
                        <span className="badge muted">sin imprimir</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="sm"
                        onClick={() => setSeleccion(lote.id)}
                      >
                        Seleccionar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {q.trim() && resultados.length === 0 && (
        <p className="muted">Sin coincidencias.</p>
      )}

      {loteSel && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>
            {repo.producto(loteSel.codigoProducto)?.nombre}
          </h2>
          <p className="muted">
            <code className="inline">{loteSel.codigoProducto}</code> · Lote{' '}
            {loteSel.lote}
            {loteSel.fechaVencimiento ? ` · Vence ${loteSel.fechaVencimiento}` : ''}
          </p>

          <div className="row" style={{ marginTop: '.5rem' }}>
            <label style={{ maxWidth: 240 }}>
              Motivo
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value as MotivoImpresion)}
              >
                {MOTIVOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              onClick={reimprimir}
              disabled={imprimiendo}
              style={{ alignSelf: 'flex-end' }}
            >
              {imprimiendo ? 'Generando…' : 'Reimprimir esta etiqueta'}
            </button>
          </div>

          <h2>Historial de impresiones</h2>
          {historial.length === 0 ? (
            <p className="muted">Esta etiqueta nunca se ha impreso.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.fecha).toLocaleString()}</td>
                    <td>{h.motivo.replace('_', ' ')}</td>
                    <td>{h.usuarioId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
