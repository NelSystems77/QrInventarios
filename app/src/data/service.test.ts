import { beforeEach, describe, expect, it } from 'vitest';
import { repo } from './repo';
import {
  confirmarImportacion,
  crearImportacionDesdeExtraccion,
} from './service';
import type { ResultadoExtraccion } from '../lib/pdf/parsePharmacyPdf';

beforeEach(() => {
  repo.reset();
});

function extraccion(
  filas: { codigo: string; nombre: string; lote?: string; valida?: boolean }[],
): ResultadoExtraccion {
  return {
    paginas: 1,
    descartadas: [],
    filas: filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      lote: f.lote,
      valida: f.valida ?? true,
    })),
  };
}

describe('confirmarImportacion', () => {
  it('crea productos y lotes, ignora filas inválidas y estampa importacionId', () => {
    const imp = crearImportacionDesdeExtraccion(
      'rpt.pdf',
      extraccion([
        { codigo: '1-00-00-0001', nombre: 'A' },
        { codigo: '1-00-00-0002', nombre: 'B' },
        { codigo: '1-00-00-0003', nombre: 'C', valida: false },
      ]),
    );

    const r = confirmarImportacion(imp.id);

    expect(r.productosCreados).toBe(2);
    expect(r.lotesCreados).toBe(2);
    expect(repo.lotesDeImportacion(imp.id)).toHaveLength(2);
    expect(repo.lotesActivos().every((l) => l.importacionId === imp.id)).toBe(true);
    expect(repo.importacion(imp.id)?.estado).toBe('CONFIRMADA');
    // Las filas válidas quedan enlazadas a su lote.
    const filas = repo.filasDe(imp.id).filter((f) => f.filaValida);
    expect(filas.every((f) => !!f.loteIdResultante)).toBe(true);
  });

  it('no duplica un lote cuando dos filas comparten (código, lote)', () => {
    const imp = crearImportacionDesdeExtraccion(
      'rpt.pdf',
      extraccion([
        { codigo: '1-00-00-0009', nombre: 'Dup', lote: 'L1' },
        { codigo: '1-00-00-0009', nombre: 'Dup', lote: 'L1' },
        { codigo: '1-00-00-0009', nombre: 'Dup', lote: 'L2' },
      ]),
    );

    const r = confirmarImportacion(imp.id);

    expect(r.productosCreados).toBe(1);
    expect(r.lotesCreados).toBe(2); // L1 y L2, no tres
    const lotes = repo.lotesActivos().filter((l) => l.codigoProducto === '1-00-00-0009');
    expect(lotes.map((l) => l.lote).sort()).toEqual(['L1', 'L2']);
  });
});
