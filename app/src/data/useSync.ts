import { useSyncExternalStore } from 'react';
import { suscribirSync, versionSync } from './sync';
import { useRepo } from './useRepo';

/** Fuerza re-render cuando cambia el estado de conexión o de sincronización. */
export function useSync(): number {
  useRepo(); // los conteos pendientes viven en el repo
  return useSyncExternalStore(suscribirSync, versionSync, versionSync);
}
