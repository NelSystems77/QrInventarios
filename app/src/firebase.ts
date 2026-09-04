// Inicialización de Firebase.
//
// La config web de Firebase NO es secreta (va embebida en cualquier cliente web);
// la seguridad real la dan las Security Rules y la lista de dominios autorizados.
// Se puede sobrescribir con variables de entorno VITE_FB_* si hiciera falta.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FB_API_KEY ?? 'AIzaSyAJUKx0gi8HeQSOE_m-uifls-MPqTwXZxM',
  authDomain: env.VITE_FB_AUTH_DOMAIN ?? 'qrinventarios-73309.firebaseapp.com',
  projectId: env.VITE_FB_PROJECT_ID ?? 'qrinventarios-73309',
  storageBucket:
    env.VITE_FB_STORAGE_BUCKET ?? 'qrinventarios-73309.firebasestorage.app',
  messagingSenderId: env.VITE_FB_MSG_SENDER_ID ?? '823300861203',
  appId:
    env.VITE_FB_APP_ID ?? '1:823300861203:web:5a2c8e3e1855f1a25d7ee6',
};

export const firebaseApp = initializeApp(firebaseConfig);

// Firestore con caché local persistente (offline-first en piso de bodega).
export const db = initializeFirestore(firebaseApp, {
  ignoreUndefinedProperties: true, // los docs del repo llevan campos opcionales
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const firebaseAuth = getAuth(firebaseApp);
void setPersistence(firebaseAuth, browserLocalPersistence);

// Cloud Functions callable (misma región que los triggers).
export const funcs = getFunctions(firebaseApp, 'us-central1');

/** UID que se promueve a ADMIN la primera vez que entra (bootstrap del sistema). */
export const UID_ADMIN_BOOTSTRAP = 'dbpxHr426fXCqBaJlaEygxPuEv92';
