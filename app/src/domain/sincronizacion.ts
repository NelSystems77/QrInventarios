// Estrategia de sincronización offline (spec sección 6). Funciones puras.
//
// Regla: cuando llegan varios conteos para el mismo (sesión, lote, rol) NO se
// descarta ninguno. Se marca `esVigente = TRUE` el de `fechaRegistroLocal` más
// reciente y `FALSE` el resto. Si la diferencia entre las dos versiones más
// recientes supera el umbral de la sesión, se genera una alerta para el Auditor.

import { diferenciaRelativa } from './triangulacion';
import type { Conteo } from './types';

export function claveGrupo(c: Pick<Conteo, 'sesionId' | 'loteId' | 'rolConteo'>): string {
  return `${c.sesionId}|${c.loteId}|${c.rolConteo}`;
}

/** Ordena por fecha de registro local, más reciente primero; desempata por fechaSync. */
function porRecencia(a: Conteo, b: Conteo): number {
  return (
    b.fechaRegistroLocal.localeCompare(a.fechaRegistroLocal) ||
    (b.fechaSync ?? '').localeCompare(a.fechaSync ?? '')
  );
}

/**
 * Devuelve los conteos del grupo con `esVigente` recalculado: exactamente uno
 * queda en TRUE (el más reciente por hora de dispositivo), el resto en FALSE.
 * No modifica los objetos de entrada.
 */
export function resolverVigenciaGrupo(grupo: Conteo[]): Conteo[] {
  if (grupo.length === 0) return [];
  const ordenados = [...grupo].sort(porRecencia);
  const vigenteId = ordenados[0].id;
  return grupo.map((c) => ({ ...c, esVigente: c.id === vigenteId }));
}

export interface DiscrepanciaVersiones {
  cantidades: [number, number];
  diferenciaRelativa: number;
  detalle: string;
}

/**
 * Compara las dos versiones más recientes del grupo. Devuelve una discrepancia si
 * su diferencia relativa supera el umbral (spec 6.3), o null si no hay con qué comparar
 * o la diferencia es tolerable.
 */
export function detectarDiscrepanciaVersiones(
  grupo: Conteo[],
  umbral: number,
): DiscrepanciaVersiones | null {
  if (grupo.length < 2) return null;
  const [nueva, previa] = [...grupo].sort(porRecencia);
  if (nueva.cantidad === previa.cantidad) return null;
  const dr = diferenciaRelativa(nueva.cantidad, previa.cantidad);
  if (dr < umbral) return null;
  return {
    cantidades: [previa.cantidad, nueva.cantidad],
    diferenciaRelativa: dr,
    detalle:
      `Dos versiones del conteo difieren ${(dr * 100).toFixed(0)}% ` +
      `(${previa.cantidad} → ${nueva.cantidad}), sobre el umbral de ${(umbral * 100).toFixed(0)}%.`,
  };
}

/**
 * Selecciona el conteo vigente de cada grupo (sesión, lote, rol) a partir del
 * conjunto completo. La vigencia se DERIVA en lectura, no se guarda: los conteos
 * se almacenan append-only (clave para sincronización multi-dispositivo sin
 * reescrituras ni carreras). Devuelve copias con `esVigente = true`.
 */
export function seleccionarVigentes(conteos: Conteo[]): Conteo[] {
  return [...agruparConteos(conteos).values()]
    .flatMap((g) => resolverVigenciaGrupo(g))
    .filter((c) => c.esVigente);
}

/** Agrupa conteos por (sesión, lote, rol). */
export function agruparConteos(conteos: Conteo[]): Map<string, Conteo[]> {
  const m = new Map<string, Conteo[]>();
  for (const c of conteos) {
    const k = claveGrupo(c);
    const arr = m.get(k) ?? [];
    arr.push(c);
    m.set(k, arr);
  }
  return m;
}
