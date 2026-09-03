// Carga los 15 productos/lotes de muestra que corresponden a las etiquetas QR de
// la carpeta `muestras/`. A diferencia de `seed.ts`, esto SÍ escribe en el
// catálogo real (se sincroniza a Firestore) para que el escaneo funcione en
// cualquier dispositivo. Requiere rol ADMIN (por las reglas de Firestore).

import registros from './muestras.json';
import { ahora, enLote, repo } from './repo';
import type { Lote } from '../domain/types';

export const MUESTRAS = registros as {
  codigo: string;
  nombre: string;
  lote: string;
  loteId: string;
}[];

export function hayLotesDeMuestra(): boolean {
  return MUESTRAS.every((m) => repo.lotesActivos().some((l) => l.id === m.loteId));
}

export function sembrarLotesDeMuestra(): number {
  let creados = 0;
  enLote(() => {
    for (const m of MUESTRAS) {
      if (!repo.producto(m.codigo)) {
        repo.upsertProducto({ codigo: m.codigo, nombre: m.nombre, createdAt: ahora() });
      }
      if (!repo.lotesActivos().some((l) => l.id === m.loteId)) {
        const lote: Lote = {
          id: m.loteId,
          codigoProducto: m.codigo,
          lote: m.lote,
          requiereQr: true,
          activo: true,
          createdAt: ahora(),
        };
        repo.upsertLote(lote);
        creados++;
      }
    }
  });
  return creados;
}
