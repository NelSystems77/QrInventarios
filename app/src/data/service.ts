// Casos de uso del módulo de generación / reimpresión de QR (spec sección 7).
// Traducen el flujo funcional a operaciones sobre el repositorio.

import type {
  EtiquetaImprimible,
} from '../lib/qr/labelSheet';
import {
  generarEtiquetaIndividual,
  generarHojaEtiquetas,
} from '../lib/qr/labelSheet';
import { construirPayload, serializarPayload } from '../lib/qr/payload';
import type {
  EtiquetaQr,
  ImportacionFila,
  ImportacionPdf,
  Lote,
  MotivoImpresion,
  Producto,
} from '../domain/types';
import type { ResultadoExtraccion } from '../lib/pdf/parsePharmacyPdf';
import { ahora, repo, uuid } from './repo';

/** Paso 1-2: guarda una importación con sus filas en estado PENDIENTE_REVISION. */
export function crearImportacionDesdeExtraccion(
  nombreArchivo: string,
  extraccion: ResultadoExtraccion,
): ImportacionPdf {
  const imp: ImportacionPdf = {
    id: uuid(),
    nombreArchivo,
    estado: 'PENDIENTE_REVISION',
    fechaImportacion: ahora(),
    totalFilas: extraccion.filas.length,
  };
  const filas: ImportacionFila[] = extraccion.filas.map((f) => ({
    id: uuid(),
    importacionId: imp.id,
    codigoExtraido: f.codigo,
    nombreExtraido: f.nombre,
    presentacionExtraida: f.presentacion,
    loteExtraido: f.lote,
    vencimientoExtraido: f.vencimiento,
    filaValida: f.valida,
    requiereQr: true,
  }));
  repo.crearImportacion(imp, filas);
  return imp;
}

/** Paso 3-4: confirma las filas válidas contra el catálogo real (productos + lotes). */
export function confirmarImportacion(importacionId: string): {
  productosCreados: number;
  lotesCreados: number;
} {
  const imp = repo.importacion(importacionId);
  if (!imp) throw new Error('Importación no encontrada');

  let productosCreados = 0;
  let lotesCreados = 0;

  for (const fila of repo.filasDe(importacionId)) {
    if (!fila.filaValida) continue;

    if (!repo.producto(fila.codigoExtraido)) {
      const producto: Producto = {
        codigo: fila.codigoExtraido,
        nombre: fila.nombreExtraido,
        presentacion: fila.presentacionExtraida,
        createdAt: ahora(),
      };
      repo.upsertProducto(producto);
      productosCreados++;
    }

    const loteTexto = fila.loteExtraido?.trim() || '—';
    const yaExiste = repo
      .lotesActivos()
      .find(
        (l) => l.codigoProducto === fila.codigoExtraido && l.lote === loteTexto,
      );

    let lote: Lote;
    if (yaExiste) {
      lote = { ...yaExiste, requiereQr: fila.requiereQr, importacionId: imp.id };
      repo.upsertLote(lote);
    } else {
      lote = {
        id: uuid(),
        codigoProducto: fila.codigoExtraido,
        lote: loteTexto,
        fechaVencimiento: fila.vencimientoExtraido,
        requiereQr: fila.requiereQr,
        activo: true,
        createdAt: ahora(),
        importacionId: imp.id,
      };
      repo.upsertLote(lote);
      lotesCreados++;
    }
    repo.actualizarFila({ ...fila, loteIdResultante: lote.id });
  }

  repo.actualizarImportacion({ ...imp, estado: 'CONFIRMADA' });
  return { productosCreados, lotesCreados };
}

export function descartarImportacion(importacionId: string) {
  const imp = repo.importacion(importacionId);
  if (imp) repo.actualizarImportacion({ ...imp, estado: 'DESCARTADA' });
}

/** spec 7.5: cambiar requiere_qr a FALSE desactiva la etiqueta impresa, no la borra. */
export function setRequiereQr(loteId: string, requiereQr: boolean) {
  const lote = repo.lotesActivos().find((l) => l.id === loteId);
  if (!lote) return;
  repo.upsertLote({ ...lote, requiereQr });
  if (!requiereQr) {
    const et = repo.etiquetaDeLote(loteId);
    if (et) repo.upsertEtiqueta({ ...et, activo: false });
  }
}

function etiquetaImprimibleDeLote(lote: Lote): EtiquetaImprimible | null {
  const producto = repo.producto(lote.codigoProducto);
  if (!producto) return null;
  const payload = serializarPayload(construirPayload(producto, lote));
  return {
    payload,
    codigo: producto.codigo,
    nombre: producto.nombre,
    lote: lote.lote,
    vencimiento: lote.fechaVencimiento,
  };
}

/**
 * Lotes con requiere_qr = TRUE que aún no tienen etiqueta impresa (spec 7.1.4).
 * Si se pasa `scope` (p. ej. los lotes de una sesión), se filtra sobre esa lista
 * en vez de sobre todo el catálogo.
 */
export function lotesPendientesDeImpresion(scope?: Lote[]): Lote[] {
  return (scope ?? repo.lotesActivos()).filter((l) => {
    if (!l.activo || !l.requiereQr) return false;
    const et = repo.etiquetaDeLote(l.id);
    return !et || et.vecesImpreso === 0;
  });
}

/** Paso 4: genera el PDF con todas las etiquetas pendientes y registra la impresión. */
export async function generarPendientes(
  usuarioId: string,
  scope?: Lote[],
): Promise<{
  pdf: Uint8Array;
  cantidad: number;
}> {
  const lotes = lotesPendientesDeImpresion(scope);
  const imprimibles: EtiquetaImprimible[] = [];

  for (const lote of lotes) {
    const imp = etiquetaImprimibleDeLote(lote);
    if (!imp) continue;
    imprimibles.push(imp);

    let et = repo.etiquetaDeLote(lote.id);
    if (!et) {
      et = {
        id: uuid(),
        loteId: lote.id,
        payloadQr: imp.payload,
        vecesImpreso: 0,
        activo: true,
      };
    }
    const actualizada: EtiquetaQr = {
      ...et,
      payloadQr: imp.payload,
      vecesImpreso: et.vecesImpreso + 1,
      ultimaImpresion: ahora(),
      activo: true,
    };
    repo.upsertEtiqueta(actualizada);
    repo.registrarImpresion({
      id: uuid(),
      etiquetaId: actualizada.id,
      usuarioId,
      motivo: 'INICIAL',
      fecha: ahora(),
    });
  }

  const pdf = await generarHojaEtiquetas(imprimibles);
  return { pdf, cantidad: imprimibles.length };
}

/** Paso 5: reimprime una sola etiqueta, exige motivo, deja historial (spec 7.1.5 / 7.5). */
export async function reimprimirLote(
  loteId: string,
  motivo: MotivoImpresion,
  usuarioId: string,
): Promise<Uint8Array> {
  const lote = repo.lotesActivos().find((l) => l.id === loteId);
  if (!lote) throw new Error('Lote no encontrado');
  const imp = etiquetaImprimibleDeLote(lote);
  if (!imp) throw new Error('Producto del lote no encontrado');

  let et = repo.etiquetaDeLote(loteId);
  if (!et) {
    et = {
      id: uuid(),
      loteId,
      payloadQr: imp.payload,
      vecesImpreso: 0,
      activo: true,
    };
  }
  const actualizada: EtiquetaQr = {
    ...et,
    payloadQr: imp.payload,
    vecesImpreso: et.vecesImpreso + 1,
    ultimaImpresion: ahora(),
    activo: true,
  };
  repo.upsertEtiqueta(actualizada);
  repo.registrarImpresion({
    id: uuid(),
    etiquetaId: actualizada.id,
    usuarioId,
    motivo,
    fecha: ahora(),
  });

  return generarEtiquetaIndividual(imp);
}

export function descargarPdf(bytes: Uint8Array, nombre: string) {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
