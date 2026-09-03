// Evaluación de alertas para el auditor (spec §6.3 y §2.4). Función pura: la usan
// tanto la app (re-evaluación en dispositivos privilegiados) como la Cloud
// Function (versión autoritativa server-side).

import { detectarDiscrepanciaVersiones, seleccionarVigentes } from './sincronizacion';
import { cantidadesDeLote, estadoTriangulacion } from './triangulacion';
import type { Conteo, RolConteo, TipoAlerta } from './types';

export interface AlertaDeseada {
  loteId: string;
  tipo: TipoAlerta;
  detalle: string;
  cantidades: number[];
}

const ROLES: RolConteo[] = ['CONTEO_1', 'CONTEO_2', 'MUESTREO'];

/**
 * A partir de TODOS los conteos de una sesión y su umbral, devuelve las alertas
 * que deberían existir abiertas. No toca almacenamiento — el llamador decide cómo
 * materializarlas (deduplicando por lote+tipo).
 */
export function evaluarAlertasSesion(
  conteos: Conteo[],
  umbral: number,
): AlertaDeseada[] {
  const porLote = new Map<string, Conteo[]>();
  for (const c of conteos) {
    const arr = porLote.get(c.loteId) ?? [];
    arr.push(c);
    porLote.set(c.loteId, arr);
  }

  const deseadas: AlertaDeseada[] = [];

  for (const [loteId, delLote] of porLote) {
    // Discrepancia entre versiones del mismo (lote, rol) — §6.3
    for (const rol of ROLES) {
      const grupo = delLote.filter((c) => c.rolConteo === rol);
      const d = detectarDiscrepanciaVersiones(grupo, umbral);
      if (d) {
        deseadas.push({
          loteId,
          tipo: 'DISCREPANCIA_VERSIONES',
          detalle: `${rol}: ${d.detalle}`,
          cantidades: d.cantidades,
        });
      }
    }

    // Discrepancia de triangulación C1≠C2 sin muestreo — §2.4
    const cant = cantidadesDeLote(seleccionarVigentes(delLote));
    if (estadoTriangulacion(cant) === 'DISCREPANCIA') {
      deseadas.push({
        loteId,
        tipo: 'DISCREPANCIA_TRIANGULACION',
        detalle: `CONTEO_1 (${cant.p1}) y CONTEO_2 (${cant.p2}) no coinciden; requiere muestreo (P3).`,
        cantidades: [cant.p1 as number, cant.p2 as number],
      });
    }
  }

  return deseadas;
}
