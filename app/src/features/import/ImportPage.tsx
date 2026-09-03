import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../components/toast';
import { crearImportacionDesdeExtraccion } from '../../data/service';
import { useRepo } from '../../data/useRepo';
import { repo } from '../../data/repo';
import { parsePharmacyPdf } from '../../lib/pdf/parsePharmacyPdf';

const ESTADO_BADGE: Record<string, string> = {
  PENDIENTE_REVISION: 'warn',
  CONFIRMADA: 'ok',
  DESCARTADA: 'muted',
};

export function ImportPage() {
  const nav = useNavigate();
  useRepo();
  const [drag, setDrag] = useState(false);
  const [cargando, setCargando] = useState(false);
  const importaciones = repo.importaciones();

  async function procesar(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('El archivo debe ser un PDF.');
      return;
    }
    setCargando(true);
    try {
      const buffer = await file.arrayBuffer();
      const extraccion = await parsePharmacyPdf(buffer);
      if (extraccion.filas.length === 0) {
        toast('No se detectaron filas de producto en el PDF.');
        return;
      }
      const imp = crearImportacionDesdeExtraccion(file.name, extraccion);
      toast(
        `${extraccion.filas.length} filas extraídas de ${extraccion.paginas} páginas` +
          (extraccion.descartadas.length
            ? ` · ${extraccion.descartadas.length} líneas no interpretadas`
            : ''),
      );
      nav(`/importar/${imp.id}`);
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el PDF: ' + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function usarEjemplo() {
    setCargando(true);
    try {
      const resp = await fetch('/ejemplo-productos.pdf');
      const blob = await resp.blob();
      await procesar(new File([blob], 'ejemplo-productos.pdf', { type: 'application/pdf' }));
    } catch {
      toast('No se pudo cargar el PDF de ejemplo.');
      setCargando(false);
    }
  }

  return (
    <>
      <h1>Importar PDF de productos</h1>
      <p className="lead">
        Sube el listado de productos de la bodega. El sistema extrae la tabla y te
        muestra una previsualización editable antes de confirmar contra el catálogo.
      </p>

      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) procesar(f);
        }}
      >
        {cargando ? (
          <p>Procesando PDF…</p>
        ) : (
          <>
            <p>Arrastra un PDF aquí, o</p>
            <label className="primary" style={{ display: 'inline-block' }}>
              <button
                className="primary"
                type="button"
                onClick={(e) => {
                  (e.currentTarget.nextElementSibling as HTMLInputElement)?.click();
                }}
              >
                Seleccionar archivo
              </button>
              <input
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) procesar(f);
                  e.target.value = '';
                }}
              />
            </label>
            <p style={{ marginBottom: 0 }}>
              <button className="ghost sm" type="button" onClick={usarEjemplo}>
                o usar el PDF de ejemplo (reporte CCSS)
              </button>
            </p>
          </>
        )}
      </div>

      <h2>Importaciones</h2>
      {importaciones.length === 0 ? (
        <p className="muted">Aún no hay importaciones.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Fecha</th>
                <th>Filas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {importaciones.map((imp) => (
                <tr key={imp.id}>
                  <td>{imp.nombreArchivo}</td>
                  <td>{new Date(imp.fechaImportacion).toLocaleString()}</td>
                  <td>{imp.totalFilas}</td>
                  <td>
                    <span className={'badge ' + (ESTADO_BADGE[imp.estado] ?? 'muted')}>
                      {imp.estado.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <button
                      className="sm"
                      onClick={() => nav(`/importar/${imp.id}`)}
                    >
                      {imp.estado === 'PENDIENTE_REVISION' ? 'Revisar' : 'Ver'}
                    </button>
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
