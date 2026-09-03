// Capa de sincronización (local-first). El repositorio local (`repo.ts`) es la
// fuente de verdad en el dispositivo; esta capa empuja los conteos pendientes a
// un backend remoto y trae los de otros dispositivos, resolviendo conflictos con
// la misma lógica de la sección 6.
//
// Hoy el "remoto" es un stub (no hay backend). Cuando entre Firebase solo se
// implementa `RemoteSync` con Firestore y se llama a `configurarRemote(...)`.

import type { Conteo } from '../domain/types';
import { ahora, repo } from './repo';

export interface RemoteSync {
  /** Sube conteos al backend. Idempotente por `clienteUuid`. */
  push(conteos: Conteo[]): Promise<void>;
  /** Trae todos los conteos de una sesión desde el backend. */
  pull(sesionId: string): Promise<Conteo[]>;
  disponible(): boolean;
}

/** Sin backend: nada que sincronizar, el dispositivo es autónomo. */
const remotoLocal: RemoteSync = {
  async push() {},
  async pull() {
    return [];
  },
  disponible: () => false,
};

let remoto: RemoteSync = remotoLocal;
let simularOffline = false;

const suscriptores = new Set<() => void>();
let versionSyncN = 0;
const notificar = () => {
  versionSyncN++;
  suscriptores.forEach((fn) => fn());
};
export const versionSync = () => versionSyncN;

export function configurarRemote(r: RemoteSync) {
  remoto = r;
  notificar();
}

export function estaOnline(): boolean {
  const nav = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return !simularOffline && nav;
}

/** El remoto está listo para sincronizar de verdad. */
export function haySync(): boolean {
  return remoto.disponible();
}

export function setSimularOffline(v: boolean): Promise<unknown> {
  simularOffline = v;
  notificar();
  return estaOnline() ? sincronizarTodo() : Promise.resolve();
}

export function estadoConexion(): 'online' | 'offline' | 'local' {
  if (!haySync()) return 'local';
  return estaOnline() ? 'online' : 'offline';
}

export function conteosPendientes(sesionId?: string): Conteo[] {
  const base = sesionId
    ? repo.conteosDeSesion(sesionId)
    : repo.sesiones().flatMap((s) => repo.conteosDeSesion(s.id));
  return base.filter((c) => c.estadoSync === 'PENDIENTE');
}

/**
 * Estado con el que nace un conteo nuevo: sin remoto ya está "en su sitio"
 * (local); con remoto nace PENDIENTE y se empuja en cuanto haya red.
 */
export function estadoSyncInicial(): 'SINCRONIZADO' | 'PENDIENTE' {
  return haySync() ? 'PENDIENTE' : 'SINCRONIZADO';
}

let sincronizando = false;
// Mutex: llamadas concurrentes se encolan en vez de perderse (evita carreras
// entre el empuje en segundo plano de `registrarConteo` y una sync explícita).
let enCurso: Promise<unknown> = Promise.resolve();

export function sincronizarSesion(
  sesionId: string,
): Promise<{ empujados: number; recibidos: number }> {
  const siguiente = enCurso
    .catch(() => {})
    .then(() => sincronizarSesionInterno(sesionId));
  enCurso = siguiente;
  return siguiente;
}

async function sincronizarSesionInterno(
  sesionId: string,
): Promise<{ empujados: number; recibidos: number }> {
  if (!haySync() || !estaOnline()) {
    return { empujados: 0, recibidos: 0 };
  }
  sincronizando = true;
  notificar();
  try {
    const pendientes = conteosPendientes(sesionId);
    if (pendientes.length) {
      await remoto.push(pendientes);
      repo.guardarConteos(
        pendientes.map((c) => ({
          ...c,
          estadoSync: 'SINCRONIZADO' as const,
          fechaSync: ahora(),
        })),
      );
    }

    const remotos = await remoto.pull(sesionId);
    let recibidos = 0;
    if (remotos.length) {
      const localesPorCu = new Map(
        repo.conteosDeSesion(sesionId).map((c) => [c.clienteUuid, c]),
      );
      const nuevos = remotos.filter((r) => !localesPorCu.has(r.clienteUuid));
      recibidos = nuevos.length;
      if (nuevos.length) {
        // Append-only: se añaden los conteos de otros dispositivos y la vigencia
        // se deriva en lectura (spec 6.2) — sin reescrituras ni carreras.
        repo.guardarConteos(
          nuevos.map((c) => ({ ...c, estadoSync: 'SINCRONIZADO' as const })),
        );
      }
    }
    return { empujados: pendientes.length, recibidos };
  } finally {
    sincronizando = false;
    notificar();
  }
}

export async function sincronizarTodo() {
  for (const s of repo.sesiones()) {
    if (s.estado === 'ACTIVO') await sincronizarSesion(s.id);
  }
}

/** Espera a que termine cualquier sincronización en curso (útil en pruebas). */
export function esperarSync(): Promise<unknown> {
  return enCurso.catch(() => {});
}

export function estaSincronizando() {
  return sincronizando;
}

// ---- Suscripción para React ----
export function suscribirSync(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

let escuchaInstalada = false;
export function instalarEscuchaConexion() {
  if (escuchaInstalada || typeof window === 'undefined') return;
  escuchaInstalada = true;
  window.addEventListener('online', () => {
    notificar();
    void sincronizarTodo();
  });
  window.addEventListener('offline', notificar);
}
