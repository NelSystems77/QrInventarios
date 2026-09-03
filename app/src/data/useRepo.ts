import { useSyncExternalStore } from 'react';
import { repo } from './repo';

/**
 * Re-renderiza el componente en cada escritura del repositorio y devuelve el
 * número de versión, útil como dependencia de useMemo.
 */
export function useRepo(): number {
  return useSyncExternalStore(repo.subscribe, repo.version, repo.version);
}
