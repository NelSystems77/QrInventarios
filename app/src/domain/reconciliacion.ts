// Reconciliación a nivel de código: "Stock SIFA" (existencia del sistema, cargada
// de un reporte RptSIFA032) frente a "Stock físico" (resultado triangulado del
// doble conteo ciego, sección 3). Función pura: se prueba de forma aislada.

import type {
  EstadoReconciliacion,
  FilaConsolidado,
  FilaReconciliacion,
  StockSifa,
} from './types';

/** Redondeo a 3 decimales para comparar cifras con parte fraccionaria del reporte. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Agrupa las filas del consolidado (una por lote) por código y las cruza con las
 * existencias cargadas. Un código entra en la vista si tiene lotes en la sesión
 * o si se le cargó existencia.
 */
export function construirReconciliacion(
  filasConsolidado: FilaConsolidado[],
  existencias: StockSifa[],
): FilaReconciliacion[] {
  const sifaPorCodigo = new Map<string, StockSifa>();
  for (const e of existencias) sifaPorCodigo.set(e.codigo, e);

  interface Acum {
    codigo: string;
    nombre: string;
    lotesTotales: number;
    lotesResueltos: number;
    sumaFisico: number;
  }
  const porCodigo = new Map<string, Acum>();

  for (const f of filasConsolidado) {
    const a =
      porCodigo.get(f.codigo) ??
      { codigo: f.codigo, nombre: f.nombre, lotesTotales: 0, lotesResueltos: 0, sumaFisico: 0 };
    a.lotesTotales += 1;
    if (f.stockOficial !== null) {
      a.lotesResueltos += 1;
      a.sumaFisico += f.stockOficial;
    }
    porCodigo.set(f.codigo, a);
  }

  // Códigos con existencia cargada pero sin ningún lote en la sesión.
  for (const e of existencias) {
    if (!porCodigo.has(e.codigo)) {
      porCodigo.set(e.codigo, {
        codigo: e.codigo,
        nombre: e.nombreReporte ?? e.codigo,
        lotesTotales: 0,
        lotesResueltos: 0,
        sumaFisico: 0,
      });
    }
  }

  const filas: FilaReconciliacion[] = [];
  for (const a of porCodigo.values()) {
    const sifa = sifaPorCodigo.get(a.codigo);
    const stockSifa = sifa ? r3(sifa.existencia) : null;

    const triangulacionCerrada =
      a.lotesTotales > 0 && a.lotesResueltos === a.lotesTotales;
    const stockFisico = triangulacionCerrada ? r3(a.sumaFisico) : null;

    let diferencia: number | null = null;
    let estado: EstadoReconciliacion;
    if (stockSifa === null) {
      estado = 'SIN_SIFA';
    } else if (stockFisico === null) {
      estado = 'PENDIENTE';
    } else {
      diferencia = r3(stockFisico - stockSifa);
      estado =
        diferencia === 0 ? 'CUADRA' : diferencia > 0 ? 'SOBRANTE' : 'FALTANTE';
    }

    filas.push({
      codigo: a.codigo,
      nombre: a.nombre,
      stockSifa,
      stockFisico,
      lotesTotales: a.lotesTotales,
      lotesResueltos: a.lotesResueltos,
      diferencia,
      estado,
    });
  }

  return filas.sort((x, y) => x.codigo.localeCompare(y.codigo));
}
