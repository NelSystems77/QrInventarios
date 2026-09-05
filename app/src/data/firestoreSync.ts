// Sincronización con Firestore (local-first).
//
// - Colecciones acotadas (catálogo, equipo): snapshots de colección completa.
// - `conteos` y `alertas`: snapshot acotado a la SESIÓN ACTIVA (las selecciona
//   `setSesionActiva`), porque crecen sin techo. Un contador además solo recibe
//   sus propios conteos (blind count).
// - `importaciones_filas`: acotado a la IMPORTACIÓN ACTIVA (`setImportacionActiva`).
// - El "sink" del repo empuja cada escritura local a Firestore.

import {
  type Firestore,
  type Query,
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db as fs } from '../firebase';
import type { Conteo } from '../domain/types';
import { aplicarRemoto, enLote, repo, setSink, type Coleccion } from './repo';
import { configurarRemote, type RemoteSync } from './sync';

const FS: Record<Coleccion, string> = {
  productos: 'productos',
  lotes: 'lotes',
  importaciones: 'importaciones_pdf',
  filas: 'importaciones_filas',
  etiquetas: 'etiquetas_qr',
  historial: 'historial_impresiones',
  usuarios: 'usuarios',
  sesiones: 'sesiones',
  ubicaciones: 'ubicaciones',
  miembros: 'miembros',
  conteos: 'conteos',
  alertas: 'alertas',
  stockSifa: 'stock_sifa',
};

let activo = false;
let opciones: OpcionesSync | null = null;
/** unsubs de listeners fijos (catálogo/equipo). */
let fijos: (() => void)[] = [];
/** unsubs de listeners acotados, por clave lógica. */
const acotados = new Map<string, () => void>();
let sesionActiva: string | null = null;
let importacionActiva: string | null = null;
let onConteosCambian: ((sesionId: string) => void) | null = null;

export const firestoreActivo = () => activo;

/**
 * `estadoSync` / `fechaSync` son bookkeeping LOCAL de la cola offline: no tienen
 * sentido en Firestore (allá el doc "ya está sincronizado" por definición) y
 * ensucian el documento que lee la Cloud Function. Se quitan antes de subir; al
 * bajar, un conteo del servidor se considera SINCRONIZADO.
 */
function aFirestore(col: Coleccion, docData: unknown): unknown {
  if (col === 'conteos' && docData && typeof docData === 'object') {
    const { estadoSync: _e, fechaSync: _f, ...resto } = docData as Conteo;
    void _e;
    void _f;
    return resto;
  }
  return docData;
}

export interface OpcionesSync {
  privilegiado: boolean;
  usuarioId: string;
  onError?: (e: unknown) => void;
  /** Se llama (en dispositivos privilegiados) cuando cambian los conteos de la sesión activa. */
  onConteosSesion?: (sesionId: string) => void;
}

function suscribir(
  col: Coleccion,
  q: Query | ReturnType<typeof collection>,
  onChange?: () => void,
): () => void {
  return onSnapshot(
    q,
    (snap) => {
      aplicarRemoto(() => {
        enLote(() => {
          for (const ch of snap.docChanges()) {
            if (ch.type === 'removed') {
              repo.aplicarDoc(col, ch.doc.id, null);
              continue;
            }
            const data = ch.doc.data();
            // Los docs de `usuarios` se guardan sin el campo `id` (la Cloud
            // Function y el alta al iniciar sesión solo escriben nombre/rol/…).
            // Sin `id`, la UI no distingue una fila de usuario de otra
            // (p. ej. asignar rol en una sesión afectaba a todos). El id del
            // doc ES el uid, que ES `Usuario.id`, así que lo reponemos aquí.
            if (col === 'usuarios') data.id = ch.doc.id;
            // Un conteo que viene del servidor ya está sincronizado.
            if (col === 'conteos' && data.estadoSync == null) {
              data.estadoSync = 'SINCRONIZADO';
            }
            repo.aplicarDoc(col, ch.doc.id, data);
          }
        });
      });
      onChange?.();
    },
    (e) => opciones?.onError?.(e),
  );
}

export function iniciarFirestoreSync(opts: OpcionesSync) {
  detenerFirestoreSync();
  activo = true;
  opciones = opts;
  onConteosCambian = opts.privilegiado ? (opts.onConteosSesion ?? null) : null;

  // 1) Local → Firestore. Las escrituras se acumulan y se envían en lotes
  //    (`writeBatch`) en el siguiente microtask: una confirmación de importación
  //    genera miles de `set` y hacer un `setDoc` suelto por cada uno satura el hilo
  //    y Firestore. Clave `col/id` → última versión gana dentro del mismo tick.
  const buffer = new Map<string, { col: Coleccion; id: string; data: unknown }>();
  let flushProgramado = false;

  const enviarBuffer = () => {
    flushProgramado = false;
    if (!activo || buffer.size === 0) return;
    const items = [...buffer.values()];
    buffer.clear();
    const LIMITE = 400; // writeBatch admite 500 operaciones
    for (let i = 0; i < items.length; i += LIMITE) {
      const lote = writeBatch(fs as Firestore);
      for (const it of items.slice(i, i + LIMITE)) {
        const ref = doc(fs as Firestore, FS[it.col], it.id);
        if (it.data === null) lote.delete(ref);
        else lote.set(ref, aFirestore(it.col, it.data) as object);
      }
      lote.commit().catch((e) => opts.onError?.(e));
    }
  };

  setSink((col, id, docData) => {
    // Las `alertas` solo las puede escribir un dispositivo privilegiado
    // (firestore.rules). En un dispositivo de contador se materializan localmente
    // para feedback inmediato; la versión en Firestore la ponen los dispositivos
    // ADMIN/AUDITOR y —de forma autoritativa— la Cloud Function `consolidarConteos`.
    if (col === 'alertas' && !opts.privilegiado) return;
    buffer.set(`${col}/${id}`, { col, id, data: docData });
    if (!flushProgramado) {
      flushProgramado = true;
      queueMicrotask(enviarBuffer);
    }
  });

  // 2) Firestore → local — colecciones acotadas (catálogo + equipo)
  const comunes: Coleccion[] = [
    'productos', 'lotes', 'etiquetas', 'historial',
    'usuarios', 'sesiones', 'ubicaciones', 'miembros',
  ];
  if (opts.privilegiado) comunes.push('importaciones');
  for (const col of comunes) {
    fijos.push(suscribir(col, collection(fs as Firestore, FS[col])));
  }

  // 3) conteos: dirección local → remoto con cola offline
  configurarRemote(firestoreRemote());

  // 4) reengancha los listeners acotados con el ámbito actual
  reengancharSesion();
  reengancharImportacion();
}

export function detenerFirestoreSync() {
  fijos.forEach((u) => u());
  fijos = [];
  acotados.forEach((u) => u());
  acotados.clear();
  setSink(null);
  activo = false;
  opciones = null;
  onConteosCambian = null;
  sesionActiva = null;
  importacionActiva = null;
}

// ── Ámbito: sesión activa ──────────────────────────────────────────────

export function setSesionActiva(sesionId: string | null) {
  if (sesionId === sesionActiva) return;
  sesionActiva = sesionId;
  reengancharSesion();
}

function reengancharSesion() {
  acotados.get('conteos')?.();
  acotados.get('alertas')?.();
  acotados.get('stockSifa')?.();
  acotados.delete('conteos');
  acotados.delete('alertas');
  acotados.delete('stockSifa');
  if (!activo || !opciones || !sesionActiva) return;
  const sid = sesionActiva;

  const conteosRef = collection(fs as Firestore, 'conteos');
  const qConteos: Query = opciones.privilegiado
    ? query(conteosRef, where('sesionId', '==', sid))
    : query(
        conteosRef,
        where('sesionId', '==', sid),
        where('usuarioId', '==', opciones.usuarioId),
      );
  acotados.set(
    'conteos',
    suscribir('conteos', qConteos, () => onConteosCambian?.(sid)),
  );

  if (opciones.privilegiado) {
    acotados.set(
      'alertas',
      suscribir(
        'alertas',
        query(collection(fs as Firestore, 'alertas'), where('sesionId', '==', sid)),
      ),
    );
    // Stock SIFA: existencias del sistema para la sesión activa. Solo lo necesitan
    // los dispositivos ADMIN/AUDITOR (vista de reconciliación).
    acotados.set(
      'stockSifa',
      suscribir(
        'stockSifa',
        query(collection(fs as Firestore, 'stock_sifa'), where('sesionId', '==', sid)),
      ),
    );
  }
}

// ── Ámbito: importación activa ─────────────────────────────────────────

export function setImportacionActiva(importacionId: string | null) {
  if (importacionId === importacionActiva) return;
  importacionActiva = importacionId;
  reengancharImportacion();
}

function reengancharImportacion() {
  acotados.get('filas')?.();
  acotados.delete('filas');
  if (!activo || !opciones?.privilegiado || !importacionActiva) return;
  acotados.set(
    'filas',
    suscribir(
      'filas',
      query(
        collection(fs as Firestore, 'importaciones_filas'),
        where('importacionId', '==', importacionActiva),
      ),
    ),
  );
}

// ── conteos: subida con cola offline ──────────────────────────────────

function firestoreRemote(): RemoteSync {
  return {
    disponible: () => true,
    async push(conteos: Conteo[]) {
      await Promise.all(
        conteos.map((c) =>
          setDoc(
            doc(fs as Firestore, 'conteos', c.id),
            aFirestore('conteos', c) as object,
          ),
        ),
      );
    },
    async pull() {
      return []; // el snapshot acotado a la sesión activa mantiene el repo al día
    },
  };
}
