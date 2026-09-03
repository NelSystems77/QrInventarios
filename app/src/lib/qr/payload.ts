// Construcción del payload JSON que se codifica dentro del QR.
// El mismo lector sirve para el flujo de conteo y para la verificación de impresión
// (spec 7.4). Se mantiene compacto para no inflar la densidad del QR.

import type { Lote, Producto, QrPayload } from '../../domain/types';

const NOMBRE_MAX = 60;

export function construirPayload(producto: Producto, lote: Lote): QrPayload {
  return {
    v: 2,
    t: 'lote',
    cod: producto.codigo,
    nom: producto.nombre.slice(0, NOMBRE_MAX),
    lot: lote.lote || '—',
    ven: lote.fechaVencimiento,
    lid: lote.id,
  };
}

export function serializarPayload(p: QrPayload): string {
  return JSON.stringify(p);
}

export function parsePayload(texto: string): QrPayload | null {
  try {
    const o = JSON.parse(texto) as QrPayload;
    if (o && o.v === 2 && o.t === 'lote' && typeof o.lid === 'string') return o;
    return null;
  } catch {
    return null;
  }
}
