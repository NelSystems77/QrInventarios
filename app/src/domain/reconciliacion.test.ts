import { describe, expect, it } from 'vitest';
import { construirReconciliacion } from './reconciliacion';
import type { FilaConsolidado, StockSifa } from './types';

function fila(
  codigo: string,
  lote: string,
  stockOficial: number | null,
): FilaConsolidado {
  return {
    loteId: `${codigo}-${lote}`,
    codigo,
    nombre: `Producto ${codigo}`,
    lote,
    cantidadP1: stockOficial,
    cantidadP2: stockOficial,
    cantidadP3: null,
    estadoTriangulacion: stockOficial === null ? 'PENDIENTE' : 'COINCIDE',
    stockOficial,
    estadoStock: stockOficial === null ? 'PENDIENTE' : 'OFICIAL',
  };
}

function sifa(codigo: string, existencia: number): StockSifa {
  return {
    id: `s__${codigo}`,
    sesionId: 's',
    codigo,
    existencia,
    fechaCarga: 'x',
  };
}

describe('construirReconciliacion', () => {
  it('suma el stock físico de los lotes de un código y lo compara con el SIFA', () => {
    const filas = [fila('A', '1', 10), fila('A', '2', 5)];
    const [r] = construirReconciliacion(filas, [sifa('A', 12)]);
    expect(r.stockFisico).toBe(15);
    expect(r.stockSifa).toBe(12);
    expect(r.diferencia).toBe(3);
    expect(r.estado).toBe('SOBRANTE');
  });

  it('FALTANTE cuando el físico es menor que el SIFA', () => {
    const [r] = construirReconciliacion([fila('A', '1', 8)], [sifa('A', 20)]);
    expect(r.diferencia).toBe(-12);
    expect(r.estado).toBe('FALTANTE');
  });

  it('CUADRA con diferencia cero', () => {
    const [r] = construirReconciliacion([fila('A', '1', 20)], [sifa('A', 20)]);
    expect(r.estado).toBe('CUADRA');
    expect(r.diferencia).toBe(0);
  });

  it('PENDIENTE mientras algún lote del código no cierre triangulación', () => {
    const filas = [fila('A', '1', 10), fila('A', '2', null)];
    const [r] = construirReconciliacion(filas, [sifa('A', 10)]);
    expect(r.stockFisico).toBeNull();
    expect(r.lotesResueltos).toBe(1);
    expect(r.lotesTotales).toBe(2);
    expect(r.estado).toBe('PENDIENTE');
  });

  it('SIN_SIFA cuando no se cargó existencia para el código', () => {
    const [r] = construirReconciliacion([fila('A', '1', 10)], []);
    expect(r.estado).toBe('SIN_SIFA');
    expect(r.diferencia).toBeNull();
  });

  it('incluye códigos con existencia cargada aunque no tengan lotes en la sesión', () => {
    const filas = construirReconciliacion([], [sifa('Z', 7)]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ codigo: 'Z', stockSifa: 7, estado: 'PENDIENTE' });
  });

  it('tolera cifras decimales del reporte', () => {
    const [r] = construirReconciliacion(
      [fila('A', '1', 231)],
      [sifa('A', 231.88)],
    );
    expect(r.diferencia).toBe(-0.88);
    expect(r.estado).toBe('FALTANTE');
  });
});
