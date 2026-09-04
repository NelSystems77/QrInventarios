// Autenticación con Firebase Auth (correo/contraseña).
//
// Al iniciar sesión: se asegura el documento `usuarios/{uid}` (rol OPERADOR por
// defecto; ADMIN para el UID de bootstrap) y se arranca la sincronización con
// Firestore acotada al rol del usuario.

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import { useSyncExternalStore } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UID_ADMIN_BOOTSTRAP, db as fs, firebaseAuth } from '../firebase';
import type { RolGlobal, Usuario } from '../domain/types';
import { repo } from '../data/repo';
import { reevaluarAlertasSesion } from '../data/conteoService';
import {
  detenerFirestoreSync,
  iniciarFirestoreSync,
} from '../data/firestoreSync';

export type EstadoSesion = 'cargando' | 'anon' | 'listo';

interface Estado {
  estado: EstadoSesion;
  uid: string | null;
  email: string | null;
  errorSync: string | null;
  /** Motivo del último cierre de sesión (p. ej. cuenta vencida), visible en login. */
  aviso: string | null;
}

let estado: Estado = {
  estado: 'cargando',
  uid: null,
  email: null,
  errorSync: null,
  aviso: null,
};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function fijar(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial };
  emit();
}

async function alIniciarSesion(uid: string, email: string | null) {
  const esBootstrap = uid === UID_ADMIN_BOOTSTRAP;
  const provisional: Usuario = {
    id: uid,
    nombre: email ?? 'Usuario',
    rolGlobal: esBootstrap ? 'ADMIN' : 'OPERADOR',
    ...(email ? { email } : {}),
  };

  const ref = doc(fs, 'usuarios', uid);
  let usuario = provisional;
  let errSync: string | null = null;
  try {
    const snap = await getDoc(ref);
    let necesitaEscritura = !snap.exists();
    if (snap.exists()) {
      usuario = { id: uid, ...(snap.data() as Omit<Usuario, 'id'>) };
      if (esBootstrap && usuario.rolGlobal !== 'ADMIN') {
        usuario = { ...usuario, rolGlobal: 'ADMIN' };
        necesitaEscritura = true;
      }
      // Backfill del correo para cuentas creadas antes de guardarlo.
      if (email && !usuario.email) {
        usuario = { ...usuario, email };
        necesitaEscritura = true;
      }
    }
    // IMPORTANTE: el doc del usuario debe existir y ser legible ANTES de arrancar
    // los listeners; varias reglas resuelven el rol con get(usuarios/{uid}).
    if (necesitaEscritura) {
      await setDoc(
        ref,
        {
          nombre: usuario.nombre,
          rolGlobal: usuario.rolGlobal,
          ...(usuario.email ? { email: usuario.email } : {}),
        },
        { merge: true },
      );
    }
  } catch (e) {
    // Firestore no disponible: se sigue local con el usuario provisional.
    errSync = (e as Error)?.message ?? 'Firestore no disponible';
  }

  // Cuenta con fecha de caducidad ya vencida: no se permite iniciar sesión.
  // (La Cloud Function `revisarCaducidades` además deshabilita la cuenta en Auth.)
  if (usuario.caducaEn && Date.parse(usuario.caducaEn) <= Date.now()) {
    fijar({ aviso: `Tu cuenta venció el ${usuario.caducaEn}. Contacta a un administrador.` });
    await fbSignOut(firebaseAuth); // dispara onAuthStateChanged(null) → estado 'anon'
    return;
  }

  repo.aplicarDoc('usuarios', uid, usuario); // espejo local; ya está en Firestore

  iniciarFirestoreSync({
    usuarioId: uid,
    privilegiado: usuario.rolGlobal === 'ADMIN' || usuario.rolGlobal === 'AUDITOR',
    onError: (e) =>
      fijar({ errorSync: (e as Error)?.message ?? 'Error de sincronización' }),
    // Dispositivos privilegiados recalculan alertas cuando llegan conteos de otros
    // dispositivos (respaldo de la Cloud Function autoritativa).
    onConteosSesion: (sesionId) => reevaluarAlertasSesion(sesionId),
  });

  fijar({ estado: 'listo', uid, email, errorSync: errSync });
}

export function iniciarAuth() {
  onAuthStateChanged(firebaseAuth, (u) => {
    if (u) {
      void alIniciarSesion(u.uid, u.email);
    } else {
      detenerFirestoreSync();
      repo.reset(); // limpia la caché local; el próximo login re-hidrata desde Firestore
      // `aviso` se conserva (lo pudo fijar `alIniciarSesion` antes de cerrar sesión).
      fijar({ estado: 'anon', uid: null, email: null });
    }
  });
}

export async function signIn(email: string, password: string) {
  fijar({ aviso: null });
  await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
}

export async function signUp(email: string, password: string, nombre: string) {
  fijar({ aviso: null });
  const cred = await createUserWithEmailAndPassword(
    firebaseAuth,
    email.trim(),
    password,
  );
  if (nombre.trim()) await updateProfile(cred.user, { displayName: nombre.trim() });
}

export async function signOut() {
  await fbSignOut(firebaseAuth);
}

// ---- Hooks ----
function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}
const snapshot = () => estado;

export function useSesion(): Estado {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Usuario actual (del repo, que Firestore mantiene al día). */
export function useUsuarioActual(): Usuario | null {
  const s = useSesion();
  useSyncExternalStore(repo.subscribe, repo.version, repo.version);
  if (!s.uid) return null;
  return (
    repo.usuario(s.uid) ?? {
      id: s.uid,
      nombre: s.email ?? 'Usuario',
      rolGlobal: 'OPERADOR' as RolGlobal,
    }
  );
}

export function esSuperAdmin(uid: string | null | undefined): boolean {
  return uid === UID_ADMIN_BOOTSTRAP;
}
