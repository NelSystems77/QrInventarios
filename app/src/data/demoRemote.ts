// Backend simulado para demostrar la sincronización offline sin Firebase.
// Guarda los conteos "en el servidor" en otra clave de localStorage, con un
// retardo artificial. Implementa la misma interfaz `RemoteSync` que tendrá el
// adaptador de Firestore — sirve de implementación de referencia.

import type { Conteo } from '../domain/types';
import type { RemoteSync } from './sync';

const KEY = 'qr-inventarios/servidor-demo/v1';
const LATENCIA_MS = 400;

function leer(): Record<string, Conteo> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Conteo>;
  } catch {
    return {};
  }
}

function escribir(data: Record<string, Conteo>) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

const espera = () => new Promise((r) => setTimeout(r, LATENCIA_MS));

export const demoRemote: RemoteSync = {
  disponible: () => true,

  async push(conteos) {
    await espera();
    const server = leer();
    for (const c of conteos) {
      // Idempotente por clienteUuid: si ya está, se conserva la versión del server.
      const existente = Object.values(server).find(
        (x) => x.clienteUuid === c.clienteUuid,
      );
      const id = existente?.id ?? c.id;
      server[id] = { ...c, id, estadoSync: 'SINCRONIZADO' };
    }
    escribir(server);
  },

  async pull(sesionId) {
    await espera();
    return Object.values(leer()).filter((c) => c.sesionId === sesionId);
  },
};
