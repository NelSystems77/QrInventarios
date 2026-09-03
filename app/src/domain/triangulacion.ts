// Motor de triangulación y regla de stock oficial (spec secciones 2.4 y 3).
// Funciones puras: no tocan el repositorio, se prueban de forma aislada.

import type {
  Conteo,
  EstadoStock,
  EstadoTriangulacion,
  FilaConsolidado,
  Lote,
  Producto,
} from './types';

export interface CantidadesTrianguladas {
  p1: number | null;
  p2: number | null;
  p3: number | null;
}

/** Toma solo los conteos vigentes de un lote y devuelve la cantidad por rol. */
export function cantidadesDeLote(
  conteosVigentesDelLote: Conteo[],
): CantidadesTrianguladas {
  const porRol = (rol: string) =>
    conteosVigentesDelLote.find((c) => c.rolConteo === rol)?.cantidad ?? null;
  return {
    p1: porRol('CONTEO_1'),
    p2: porRol('CONTEO_2'),
    p3: porRol('MUESTREO'),
  };
}

/** Estado de triangulación según la lógica de `fn_consolidado_sesion` (spec 2.4). */
export function estadoTriangulacion(
  c: CantidadesTrianguladas,
): EstadoTriangulacion {
  if (c.p1 === null || c.p2 === null) return 'PENDIENTE';
  if (c.p1 === c.p2) return 'COINCIDE';
  if (c.p3 === null) return 'DISCREPANCIA';
  return 'AUDITADO';
}

/**
 * Regla de stock oficial (spec 3):
 *  - Si C3 existe → prevalece C3.
 *  - Si C1 = C2 → prevalece C1.
 *  - Si C1 ≠ C2 y C3 es NULL → EN DISPUTA (sin stock oficial).
 *  - Si falta C1 o C2 → PENDIENTE.
 */
export function stockOficial(c: CantidadesTrianguladas): {
  stockOficial: number | null;
  estadoStock: EstadoStock;
} {
  if (c.p3 !== null) return { stockOficial: c.p3, estadoStock: 'OFICIAL' };
  if (c.p1 !== null && c.p2 !== null && c.p1 === c.p2)
    return { stockOficial: c.p1, estadoStock: 'OFICIAL' };
  if (c.p1 !== null && c.p2 !== null && c.p1 !== c.p2)
    return { stockOficial: null, estadoStock: 'EN_DISPUTA' };
  return { stockOficial: null, estadoStock: 'PENDIENTE' };
}

/** Diferencia relativa entre dos cantidades (0–1), tolerante a ceros. */
export function diferenciaRelativa(a: number, b: number): number {
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 0;
  return Math.abs(a - b) / max;
}

export interface EntradaConsolidado {
  lote: Lote;
  producto?: Producto;
  conteosVigentes: Conteo[];
}

/** Construye la vista consolidada de una sesión (equivalente a `fn_consolidado_sesion`). */
export function construirConsolidado(
  entradas: EntradaConsolidado[],
): FilaConsolidado[] {
  return entradas
    .map(({ lote, producto, conteosVigentes }) => {
      const cant = cantidadesDeLote(conteosVigentes);
      const tri = estadoTriangulacion(cant);
      const { stockOficial: stock, estadoStock } = stockOficial(cant);
      return {
        loteId: lote.id,
        codigo: lote.codigoProducto,
        nombre: producto?.nombre ?? '(producto no encontrado)',
        lote: lote.lote,
        fechaVencimiento: lote.fechaVencimiento,
        cantidadP1: cant.p1,
        cantidadP2: cant.p2,
        cantidadP3: cant.p3,
        estadoTriangulacion: tri,
        stockOficial: stock,
        estadoStock,
      } satisfies FilaConsolidado;
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo) || a.lote.localeCompare(b.lote));
}
