import { useEffect } from 'react';
import { setImportacionActiva, setSesionActiva } from './firestoreSync';

/** Acota el snapshot de conteos/alertas de Firestore a esta sesión mientras la página esté montada. */
export function useSesionActiva(sesionId: string | undefined) {
  useEffect(() => {
    if (sesionId) setSesionActiva(sesionId);
    return () => setSesionActiva(null);
  }, [sesionId]);
}

/** Acota el snapshot de filas de importación a esta importación. */
export function useImportacionActiva(importacionId: string | undefined) {
  useEffect(() => {
    if (importacionId) setImportacionActiva(importacionId);
    return () => setImportacionActiva(null);
  }, [importacionId]);
}
