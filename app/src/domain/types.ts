// Modelo de dominio de QR Inventarios by NelSystems.
// Adaptado del schema PostgreSQL v2 (secciones 2 y 7.2 de la especificación)
// a documentos planos para poder persistir en Firestore o en localStorage.

export type UUID = string;

/** Identidad del producto: código único, sin datos de lote (spec 2.1). */
export interface Producto {
  codigo: string; // Ej: '1-10-13-0003'
  nombre: string;
  /** Prefijo de presentación del reporte CCSS (FC, CN, LT, ...). Informativo. */
  presentacion?: string;
  createdAt: string; // ISO
}

/** Un producto puede tener N lotes con vencimientos distintos (spec 2.1). */
export interface Lote {
  id: UUID;
  codigoProducto: string;
  lote: string; // '—' cuando el origen no reporta lote
  fechaVencimiento?: string; // ISO date o undefined
  requiereQr: boolean; // el usuario puede excluirlo (spec 7.1.3)
  activo: boolean;
  createdAt: string;
}

export type EstadoImportacion = 'PENDIENTE_REVISION' | 'CONFIRMADA' | 'DESCARTADA';

/** Cabecera de una importación de PDF (spec 7.2 · importaciones_pdf). */
export interface ImportacionPdf {
  id: UUID;
  nombreArchivo: string;
  estado: EstadoImportacion;
  fechaImportacion: string;
  totalFilas: number;
}

/** Fila extraída del PDF antes de confirmarla contra el catálogo (spec 7.2). */
export interface ImportacionFila {
  id: UUID;
  importacionId: UUID;
  codigoExtraido: string;
  nombreExtraido: string;
  presentacionExtraida?: string;
  loteExtraido?: string;
  vencimientoExtraido?: string;
  filaValida: boolean; // FALSE si el parser no pudo leerla bien
  requiereQr: boolean; // selección de exclusiones antes de confirmar
  loteIdResultante?: UUID; // se llena al confirmar
}

/** Etiqueta QR asociada a un lote — máx. una activa por lote (spec 7.2 / 7.5). */
export interface EtiquetaQr {
  id: UUID;
  loteId: UUID;
  payloadQr: string; // el JSON exacto codificado en el QR
  vecesImpreso: number;
  ultimaImpresion?: string;
  activo: boolean;
}

export type MotivoImpresion = 'INICIAL' | 'DANADA' | 'EXTRAVIADA' | 'RE_ETIQUETADO';

/** Historial completo de impresiones de una etiqueta (spec 7.2 / 7.5). */
export interface HistorialImpresion {
  id: UUID;
  etiquetaId: UUID;
  usuarioId: string;
  motivo: MotivoImpresion;
  fecha: string;
}

// ───────────────────────── Flujo de conteo (spec 2–3, 6) ─────────────────────────

export type RolConteo = 'CONTEO_1' | 'CONTEO_2' | 'MUESTREO';
export type RolGlobal = 'ADMIN' | 'AUDITOR' | 'OPERADOR';

export interface Usuario {
  id: UUID;
  nombre: string;
  rolGlobal: RolGlobal;
  /** Correo de acceso; se persiste al iniciar sesión y al crear la cuenta. */
  email?: string;
  /** Fecha de caducidad ISO 'YYYY-MM-DD'. Ausente = sin caducidad. Pasada esa
   *  fecha la Cloud Function deshabilita la cuenta y el login la rechaza. */
  caducaEn?: string;
}

export type EstadoSesion = 'ACTIVO' | 'CERRADO';

export interface SesionInventario {
  id: UUID;
  nombre: string;
  estado: EstadoSesion;
  fechaInicio: string;
  /** Umbral (0–1) de diferencia entre versiones que dispara alerta al auditor (spec 6.3). */
  umbralDiscrepancia: number;
}

export interface Ubicacion {
  id: UUID;
  nombre: string; // Ej: 'Bodega Central - Estante A3'
}

/** Rol de un usuario dentro de una sesión concreta — base del blind count (spec 2.3). */
export interface MiembroSesion {
  id: UUID;
  sesionId: UUID;
  usuarioId: UUID;
  rol: RolConteo;
}

export type EstadoSync = 'PENDIENTE' | 'SINCRONIZADO';

/** Conteo individual. Sin UNIQUE duro sobre (sesión, lote, rol): se permite corregir
 *  conservando trazabilidad vía `esVigente` (spec 2.2 y 6). */
export interface Conteo {
  id: UUID;
  sesionId: UUID;
  loteId: UUID;
  ubicacionId?: UUID;
  usuarioId: UUID;
  rolConteo: RolConteo;
  cantidad: number;
  ingresoManual: boolean; // fallback sin QR legible (spec 5)
  esVigente: boolean; // FALSE = corregido / reemplazado por una versión más reciente
  clienteUuid: UUID; // generado en el dispositivo — dedupe idempotente (spec 6.1)
  fechaRegistroLocal: string; // hora del dispositivo al capturar
  fechaSync?: string; // hora del servidor al recibir
  estadoSync: EstadoSync; // para el indicador "Pendiente de sincronizar" (spec 6.4)
}

export type TipoAlerta = 'DISCREPANCIA_VERSIONES' | 'DISCREPANCIA_TRIANGULACION';

/** Alerta para el Auditor (P3) (spec 6.3). */
export interface AlertaAuditoria {
  id: UUID;
  sesionId: UUID;
  loteId: UUID;
  tipo: TipoAlerta;
  detalle: string;
  cantidades: number[];
  fechaCreacion: string;
  atendida: boolean;
}

export type EstadoTriangulacion =
  | 'PENDIENTE'
  | 'COINCIDE'
  | 'DISCREPANCIA'
  | 'AUDITADO';

export type EstadoStock = 'OFICIAL' | 'EN_DISPUTA' | 'PENDIENTE';

/** Fila de la vista consolidada de una sesión (spec 2.4 + regla de stock 3). */
export interface FilaConsolidado {
  loteId: UUID;
  codigo: string;
  nombre: string;
  lote: string;
  fechaVencimiento?: string;
  cantidadP1: number | null;
  cantidadP2: number | null;
  cantidadP3: number | null;
  estadoTriangulacion: EstadoTriangulacion;
  stockOficial: number | null;
  estadoStock: EstadoStock;
}

/** Payload JSON que se codifica dentro del QR. Mismo lector para conteo y verificación. */
export interface QrPayload {
  v: 2;
  t: 'lote';
  cod: string; // código de producto
  nom: string; // nombre (truncado para densidad del QR)
  lot: string; // lote ('—' si no aplica)
  ven?: string; // vencimiento ISO
  lid: UUID; // lote_id — clave de resolución en el flujo de conteo
}
