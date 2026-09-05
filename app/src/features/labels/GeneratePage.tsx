import { useState } from 'react';
import { toast } from '../../components/toast';
import { useUsuarioActual } from '../../auth/firebaseAuth';
import { repo } from '../../data/repo';
import {
  descargarPdf,
  generarPendientes,
  lotesPendientesDeImpresion,
} from '../../data/service';
import { useRepo } from '../../data/useRepo';

export function GeneratePage() {
  useRepo();
  const usuario = useUsuarioActual();
  const [generando, setGenerando] = useState(false);
  const pendientes = lotesPendientesDeImpresion();

  async function generar() {
    if (!usuario) return;
    setGenerando(true);
    try {
      const { pdf, cantidad } = await generarPendientes(usuario.id);
      if (cantidad === 0) {
        toast('No hay etiquetas pendientes.');
        return;
      }
      descargarPdf(
        pdf,
        `etiquetas-qr-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
      toast(`${cantidad} etiquetas generadas y marcadas como impresas.`);
    } catch (e) {
      console.error(e);
      toast('Error al generar: ' + (e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <h1>Generar etiquetas</h1>
      <p className="lead">
        Genera un PDF imprimible (layout Avery 5160, 30 etiquetas por hoja carta)
        con una etiqueta por cada lote que requiere QR y aún no tiene etiqueta
        impresa. Cada etiqueta lleva el QR más código, nombre, lote y vencimiento
        para lectura humana de respaldo.
      </p>

      <div className="card">
        <div className="stat" style={{ margin: 0 }}>
          <div>
            <div className="n">{pendientes.length}</div>
            <div className="l">etiquetas pendientes</div>
          </div>
          <div>
            <div className="n">
              {repo.etiquetas().filter((e) => e.vecesImpreso > 0).length}
            </div>
            <div className="l">etiquetas ya impresas</div>
          </div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button
            className="primary"
            onClick={generar}
            disabled={generando || pendientes.length === 0}
          >
            {generando
              ? 'Generando…'
              : `Generar PDF de ${pendientes.length} etiquetas`}
          </button>
        </div>
      </div>

      {pendientes.length > 0 && (
        <>
          <h2>Pendientes</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th style={{ width: 110 }}>Lote</th>
                  <th style={{ width: 120 }}>Vence</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.slice(0, 500).map((l) => (
                  <tr key={l.id}>
                    <td>{l.codigoProducto}</td>
                    <td>{repo.producto(l.codigoProducto)?.nombre ?? '—'}</td>
                    <td>{l.lote}</td>
                    <td>{l.fechaVencimiento ?? '—'}</td>
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
