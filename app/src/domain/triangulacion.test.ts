import { describe, expect, it } from 'vitest';
import {
  cantidadesDeLote,
  diferenciaRelativa,
  estadoTriangulacion,
  stockOficial,
} from './triangulacion';
import type { Conteo } from './types';

function conteo(rol: Conteo['rolConteo'], cantidad: number): Conteo {
  return {
    id: `${rol}-${cantidad}`,
    sesionId: 's1',
    loteId: 'l1',
    usuarioId: 'u1',
    rolConteo: rol,
    cantidad,
    ingresoManual: false,
    esVigente: true,
    clienteUuid: `cu-${rol}-${cantidad}`,
    fechaRegistroLocal: '2026-09-02T10:00:00Z',
    estadoSync: 'SINCRONIZADO',
  };
}

describe('estadoTriangulacion (spec 2.4)', () => {
  it('PENDIENTE si falta C1 o C2', () => {
    expect(estadoTriangulacion({ p1: 10, p2: null, p3: null })).toBe('PENDIENTE');
    expect(estadoTriangulacion({ p1: null, p2: 10, p3: null })).toBe('PENDIENTE');
  });
  it('COINCIDE si C1 = C2', () => {
    expect(estadoTriangulacion({ p1: 10, p2: 10, p3: null })).toBe('COINCIDE');
  });
  it('DISCREPANCIA si C1 ≠ C2 y no hay muestreo', () => {
    expect(estadoTriangulacion({ p1: 10, p2: 12, p3: null })).toBe('DISCREPANCIA');
  });
  it('AUDITADO si C1 ≠ C2 pero hay muestreo', () => {
    expect(estadoTriangulacion({ p1: 10, p2: 12, p3: 11 })).toBe('AUDITADO');
  });
});

describe('stockOficial (spec 3)', () => {
  it('prevalece C3 cuando existe', () => {
    expect(stockOficial({ p1: 10, p2: 12, p3: 11 })).toEqual({
      stockOficial: 11,
      estadoStock: 'OFICIAL',
    });
    // incluso si C1 = C2, C3 manda
    expect(stockOficial({ p1: 10, p2: 10, p3: 9 }).stockOficial).toBe(9);
  });
  it('prevalece C1 cuando C1 = C2 y no hay C3', () => {
    expect(stockOficial({ p1: 10, p2: 10, p3: null })).toEqual({
      stockOficial: 10,
      estadoStock: 'OFICIAL',
    });
  });
  it('EN_DISPUTA cuando C1 ≠ C2 y C3 es null', () => {
    expect(stockOficial({ p1: 10, p2: 12, p3: null })).toEqual({
      stockOficial: null,
      estadoStock: 'EN_DISPUTA',
    });
  });
  it('PENDIENTE cuando falta un conteo base', () => {
    expect(stockOficial({ p1: 10, p2: null, p3: null }).estadoStock).toBe(
      'PENDIENTE',
    );
  });
  it('stock 0 es un stock oficial válido, no "sin dato"', () => {
    expect(stockOficial({ p1: 0, p2: 0, p3: null })).toEqual({
      stockOficial: 0,
      estadoStock: 'OFICIAL',
    });
  });
});

describe('cantidadesDeLote', () => {
  it('mapea conteos por rol', () => {
    expect(
      cantidadesDeLote([conteo('CONTEO_1', 5), conteo('MUESTREO', 7)]),
    ).toEqual({ p1: 5, p2: null, p3: 7 });
  });
});

describe('diferenciaRelativa', () => {
  it('0 cuando ambos son 0', () => {
    expect(diferenciaRelativa(0, 0)).toBe(0);
  });
  it('20% entre 10 y 12', () => {
    expect(diferenciaRelativa(10, 12)).toBeCloseTo(0.1667, 3);
    expect(diferenciaRelativa(100, 80)).toBe(0.2);
  });
});
