// Repositorio de datos local — única capa de acceso a datos de la app.
//
// Fuente de verdad EN EL DISPOSITIVO. Persiste en localStorage y, si se registra
// un "sink" (ver `firestoreSync.ts`), replica cada escritura a Firestore. Las
// escrituras que vienen de Firestore se aplican con `aplicarRemoto(...)` para no
// reenviarlas (evita el bucle eco).

import type {
  AlertaAuditoria,
  Conteo,
  EtiquetaQr,
  HistorialImpresion,
  ImportacionFila,
  ImportacionPdf,
  Lote,
  MiembroSesion,
  Producto,
  SesionInventario,
  Ubicacion,
  Usuario,
} from '../domain/types';

interface DB {
  productos: Record<string, Producto>;
  lotes: Record<string, Lote>;
  importaciones: Record<string, ImportacionPdf>;
  filas: Record<string, ImportacionFila>;
  etiquetas: Record<string, EtiquetaQr>;
  historial: Record<string, HistorialImpresion>;
  usuarios: Record<string, Usuario>;
  sesiones: Record<string, SesionInventario>;
  ubicaciones: Record<string, Ubicacion>;
  miembros: Record<string, MiembroSesion>;
  conteos: Record<string, Conteo>;
  alertas: Record<string, AlertaAuditoria>;
}

export type Coleccion = keyof DB;

const KEY = 'qr-inventarios/db/v1';

const vacio: DB = {
  productos: {}, lotes: {}, importaciones: {}, filas: {}, etiquetas: {},
  historial: {}, usuarios: {}, sesiones: {}, ubicaciones: {}, miembros: {},
  conteos: {}, alertas: {},
};

function cargar(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(vacio);
    return { ...structuredClone(vacio), ...(JSON.parse(raw) as DB) };
  } catch {
    return structuredClone(vacio);
  }
}

let db = cargar();
let version = 0;
const suscriptores = new Set<() => void>();

let sink: ((col: Coleccion, id: string, doc: unknown | null) => void) | null = null;
let aplicandoRemoto = false;
let lotePersistir = 0;

export function setSink(s: typeof sink) {
  sink = s;
}

/** Aplica cambios provenientes del remoto sin reenviarlos por el sink. */
export function aplicarRemoto<T>(fn: () => T): T {
  const prev = aplicandoRemoto;
  aplicandoRemoto = true;
  try {
    return fn();
  } finally {
    aplicandoRemoto = prev;
  }
}

/** Agrupa varias escrituras en una sola persistencia + notificación. */
export function enLote(fn: () => void) {
  lotePersistir++;
  try {
    fn();
  } finally {
    lotePersistir--;
    if (lotePersistir === 0) flush();
  }
}

function flush() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* almacenamiento lleno o no disponible */
  }
  suscriptores.forEach((fn) => fn());
}

function set<T>(col: Coleccion, id: string, doc: T) {
  (db[col] as Record<string, T>)[id] = doc;
  if (sink && !aplicandoRemoto) sink(col, id, doc);
  if (lotePersistir === 0) flush();
}

function del(col: Coleccion, id: string) {
  delete (db[col] as Record<string, unknown>)[id];
  if (sink && !aplicandoRemoto) sink(col, id, null);
  if (lotePersistir === 0) flush();
}

export const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const ahora = (): string => new Date().toISOString();

export const repo = {
  subscribe(fn: () => void): () => void {
    suscriptores.add(fn);
    return () => suscriptores.delete(fn);
  },
  /** Token que cambia en cada escritura — para useSyncExternalStore y deps de useMemo. */
  version: () => version,
  snapshot: () => db,

  /** Escritura genérica (la usa la sincronización con Firestore). */
  aplicarDoc(col: Coleccion, id: string, doc: unknown | null) {
    if (doc === null) del(col, id);
    else set(col, id, doc);
  },
  /** Borra un documento (propaga a Firestore vía sink). */
  eliminarDoc(col: Coleccion, id: string) {
    del(col, id);
  },

  // ---- Productos y lotes ----
  upsertProducto(p: Producto) {
    set('productos', p.codigo, p);
  },
  upsertLote(l: Lote) {
    set('lotes', l.id, l);
  },
  lotesActivos(): Lote[] {
    return Object.values(db.lotes).filter((l) => l.activo);
  },
  producto(codigo: string): Producto | undefined {
    return db.productos[codigo];
  },

  // ---- Importaciones ----
  crearImportacion(imp: ImportacionPdf, filas: ImportacionFila[]) {
    enLote(() => {
      set('importaciones', imp.id, imp);
      for (const f of filas) set('filas', f.id, f);
    });
  },
  actualizarImportacion(imp: ImportacionPdf) {
    set('importaciones', imp.id, imp);
  },
  actualizarFila(f: ImportacionFila) {
    set('filas', f.id, f);
  },
  filasDe(importacionId: string): ImportacionFila[] {
    return Object.values(db.filas).filter((f) => f.importacionId === importacionId);
  },
  importaciones(): ImportacionPdf[] {
    return Object.values(db.importaciones).sort((a, b) =>
      b.fechaImportacion.localeCompare(a.fechaImportacion),
    );
  },
  importacion(id: string): ImportacionPdf | undefined {
    return db.importaciones[id];
  },

  // ---- Etiquetas ----
  upsertEtiqueta(e: EtiquetaQr) {
    set('etiquetas', e.id, e);
  },
  etiquetaDeLote(loteId: string): EtiquetaQr | undefined {
    return Object.values(db.etiquetas).find((e) => e.loteId === loteId);
  },
  etiquetas(): EtiquetaQr[] {
    return Object.values(db.etiquetas);
  },
  registrarImpresion(h: HistorialImpresion) {
    set('historial', h.id, h);
  },
  historialDeEtiqueta(etiquetaId: string): HistorialImpresion[] {
    return Object.values(db.historial)
      .filter((h) => h.etiquetaId === etiquetaId)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  },

  // ---- Usuarios ----
  upsertUsuario(u: Usuario) {
    set('usuarios', u.id, u);
  },
  usuario(id: string): Usuario | undefined {
    return db.usuarios[id];
  },
  usuarios(): Usuario[] {
    return Object.values(db.usuarios);
  },

  // ---- Sesiones / ubicaciones / miembros ----
  upsertSesion(s: SesionInventario) {
    set('sesiones', s.id, s);
  },
  sesion(id: string): SesionInventario | undefined {
    return db.sesiones[id];
  },
  sesiones(): SesionInventario[] {
    return Object.values(db.sesiones).sort((a, b) =>
      b.fechaInicio.localeCompare(a.fechaInicio),
    );
  },
  upsertUbicacion(u: Ubicacion) {
    set('ubicaciones', u.id, u);
  },
  ubicaciones(): Ubicacion[] {
    return Object.values(db.ubicaciones);
  },
  upsertMiembro(m: MiembroSesion) {
    set('miembros', m.id, m);
  },
  miembrosDeSesion(sesionId: string): MiembroSesion[] {
    return Object.values(db.miembros).filter((m) => m.sesionId === sesionId);
  },
  miembro(sesionId: string, usuarioId: string): MiembroSesion | undefined {
    return Object.values(db.miembros).find(
      (m) => m.sesionId === sesionId && m.usuarioId === usuarioId,
    );
  },

  // ---- Conteos ----
  conteoPorClienteUuid(clienteUuid: string): Conteo | undefined {
    return Object.values(db.conteos).find((c) => c.clienteUuid === clienteUuid);
  },
  conteosDeSesion(sesionId: string): Conteo[] {
    return Object.values(db.conteos).filter((c) => c.sesionId === sesionId);
  },
  guardarConteos(conteos: Conteo[]) {
    enLote(() => {
      for (const c of conteos) set('conteos', c.id, c);
    });
  },

  // ---- Alertas ----
  upsertAlerta(a: AlertaAuditoria) {
    set('alertas', a.id, a);
  },
  alertasDeSesion(sesionId: string): AlertaAuditoria[] {
    return Object.values(db.alertas)
      .filter((a) => a.sesionId === sesionId)
      .sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  },
  alerta(id: string): AlertaAuditoria | undefined {
    return db.alertas[id];
  },

  /** Borra todo lo local. No propaga a Firestore. */
  reset() {
    db = structuredClone(vacio);
    flush();
  },
};
