// Cloud Functions de QR Inventarios.
//
// Fuente de verdad AUTORITATIVA para lo que no puede resolver un solo dispositivo:
//  - `esVigente` de los conteos (spec §6.2), consolidado entre todos los dispositivos.
//  - Alertas para el auditor (spec §6.3 y §2.4).
//  - Borrado en cascada al eliminar una sesión.
//
// La lógica de negocio se comparte con la app: `functions/src/domain/` se copia
// desde `app/src/domain/` en el predeploy (`sync-domain.mjs`). No editar a mano.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  onDocumentDeleted,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { evaluarAlertasSesion } from './domain/alertas';
import { seleccionarVigentes } from './domain/sincronizacion';
import type { Conteo, RolGlobal, Usuario } from './domain/types';

initializeApp();
const db = getFirestore();

const REGION = 'us-central1';

/** UID que se auto-promueve a ADMIN (bootstrap). No se puede eliminar ni degradar. */
const UID_ADMIN_BOOTSTRAP = 'dbpxHr426fXCqBaJlaEygxPuEv92';

interface AlertaDoc {
  loteId: string;
  tipo: string;
  detalle: string;
  cantidades: number[];
  atendida: boolean;
  fechaCreacion: string;
}

/**
 * Al escribirse cualquier conteo: recalcula `esVigente` para todo su grupo y
 * sincroniza las alertas abiertas de la sesión. Idempotente y con punto fijo
 * (si no hay nada que cambiar, no escribe y deja de re-dispararse).
 */
export const consolidarConteos = onDocumentWritten(
  { document: 'conteos/{conteoId}', region: REGION },
  async (event) => {
    const after = event.data?.after?.data() as Conteo | undefined;
    const before = event.data?.before?.data() as Conteo | undefined;
    const sesionId = (after ?? before)?.sesionId;
    if (!sesionId) return;

    const [conteosSnap, sesionSnap, alertasSnap] = await Promise.all([
      db.collection('conteos').where('sesionId', '==', sesionId).get(),
      db.doc(`sesiones/${sesionId}`).get(),
      db.collection('alertas').where('sesionId', '==', sesionId).get(),
    ]);

    const conteos: Conteo[] = conteosSnap.docs.map(
      (d) => ({ ...(d.data() as Conteo), id: d.id }),
    );

    const batch = db.batch();
    let cambios = 0;

    // 1) esVigente autoritativo (spec §6.2)
    const vigentes = new Set(seleccionarVigentes(conteos).map((c) => c.id));
    for (const d of conteosSnap.docs) {
      const debe = vigentes.has(d.id);
      if ((d.data().esVigente ?? false) !== debe) {
        batch.update(d.ref, { esVigente: debe });
        cambios++;
      }
    }

    // 2) Alertas (spec §6.3 y §2.4)
    const umbral = (sesionSnap.data()?.umbralDiscrepancia ?? 0.2) as number;
    const deseadas = evaluarAlertasSesion(conteos, umbral);
    const abiertas = alertasSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as AlertaDoc) }))
      .filter((a) => !a.atendida);

    for (const des of deseadas) {
      const ya = abiertas.find(
        (a) => a.loteId === des.loteId && a.tipo === des.tipo,
      );
      const igual =
        ya &&
        ya.detalle === des.detalle &&
        JSON.stringify(ya.cantidades) === JSON.stringify(des.cantidades);
      if (igual) continue;

      const ref = ya ? db.doc(`alertas/${ya.id}`) : db.collection('alertas').doc();
      batch.set(ref, {
        sesionId,
        loteId: des.loteId,
        tipo: des.tipo,
        detalle: des.detalle,
        cantidades: des.cantidades,
        atendida: false,
        fechaCreacion: ya?.fechaCreacion ?? new Date().toISOString(),
      });
      cambios++;
    }

    if (cambios > 0) {
      await batch.commit();
      logger.info(`consolidarConteos: sesión ${sesionId}, ${cambios} cambios`);
    }
  },
);

/** Borrado en cascada al eliminar una sesión. */
export const limpiarSesionEliminada = onDocumentDeleted(
  { document: 'sesiones/{sesionId}', region: REGION },
  async (event) => {
    const sesionId = event.params.sesionId;
    let total = 0;
    for (const col of ['conteos', 'miembros', 'alertas']) {
      const snap = await db
        .collection(col)
        .where('sesionId', '==', sesionId)
        .get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
      total += snap.size;
    }
    logger.info(`limpiarSesionEliminada: ${sesionId}, ${total} documentos`);
  },
);

// ─────────────────────── Gestión de usuarios (Admin SDK) ───────────────────────
//
// Crear / eliminar cuentas de Auth y forzar el bloqueo por caducidad no se puede
// hacer desde el cliente. El panel *Administración → Usuarios* llama a estas
// funciones; el guard exige rolGlobal ADMIN y cuenta vigente.

const ROLES: RolGlobal[] = ['ADMIN', 'AUDITOR', 'OPERADOR'];
const hoyISO = () => new Date().toISOString().slice(0, 10);
/** `caducaEn` ('YYYY-MM-DD') ya alcanzada — comparación lexicográfica válida. */
const vencido = (caducaEn?: string | null) => !!caducaEn && caducaEn <= hoyISO();

/** Normaliza `caducaEn` de entrada: string ISO válido, o undefined para "sin fecha". */
function normalizarCaducaEn(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new HttpsError('invalid-argument', 'Fecha de caducidad inválida.');
  }
  return v;
}

async function exigirAdmin(auth: { uid: string } | undefined): Promise<void> {
  if (!auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const snap = await db.doc(`usuarios/${auth.uid}`).get();
  const u = snap.data() as Usuario | undefined;
  if (!u || u.rolGlobal !== 'ADMIN' || vencido(u.caducaEn)) {
    throw new HttpsError('permission-denied', 'Requiere una cuenta ADMIN vigente.');
  }
}

/** Borra el doc del usuario y sus membresías de sesión. Los conteos se conservan. */
async function purgarDatosUsuario(uid: string): Promise<void> {
  const miembros = await db
    .collection('miembros')
    .where('usuarioId', '==', uid)
    .get();
  const batch = db.batch();
  batch.delete(db.doc(`usuarios/${uid}`));
  for (const d of miembros.docs) batch.delete(d.ref);
  await batch.commit();
}

interface CrearInput {
  accion: 'crear';
  email: string;
  password: string;
  nombre: string;
  rolGlobal: RolGlobal;
  caducaEn?: string;
}
interface ActualizarInput {
  accion: 'actualizar';
  uid: string;
  nombre?: string;
  rolGlobal?: RolGlobal;
  caducaEn?: string | null;
}
interface EliminarInput {
  accion: 'eliminar';
  uid: string;
}
type AdminUsuariosInput = CrearInput | ActualizarInput | EliminarInput;

export const administrarUsuarios = onCall(
  { region: REGION },
  async (request) => {
    await exigirAdmin(request.auth);
    const data = request.data as AdminUsuariosInput;
    const callerUid = request.auth!.uid;

    // ---- crear ----
    if (data.accion === 'crear') {
      const email = (data.email ?? '').trim();
      const nombre = (data.nombre ?? '').trim();
      if (!email || !nombre) {
        throw new HttpsError('invalid-argument', 'Correo y nombre son obligatorios.');
      }
      if (!ROLES.includes(data.rolGlobal)) {
        throw new HttpsError('invalid-argument', 'Rol global inválido.');
      }
      const caducaEn = normalizarCaducaEn(data.caducaEn);
      let uid: string;
      try {
        const u = await getAuth().createUser({
          email,
          password: data.password,
          displayName: nombre,
        });
        uid = u.uid;
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code === 'auth/email-already-exists') {
          throw new HttpsError('already-exists', 'Ese correo ya tiene cuenta.');
        }
        if (code === 'auth/invalid-password' || code === 'auth/weak-password') {
          throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
        }
        if (code === 'auth/invalid-email') {
          throw new HttpsError('invalid-argument', 'Correo inválido.');
        }
        throw new HttpsError('internal', (e as Error).message);
      }
      await db.doc(`usuarios/${uid}`).set({
        nombre,
        email,
        rolGlobal: data.rolGlobal,
        ...(caducaEn ? { caducaEn } : {}),
      });
      if (vencido(caducaEn)) await getAuth().updateUser(uid, { disabled: true });
      logger.info(`administrarUsuarios: creado ${uid} (${email}) por ${callerUid}`);
      return { uid };
    }

    // ---- actualizar ----
    if (data.accion === 'actualizar') {
      if (!data.uid) throw new HttpsError('invalid-argument', 'Falta uid.');
      const ref = db.doc(`usuarios/${data.uid}`);
      const actual = (await ref.get()).data() as Usuario | undefined;
      if (!actual) throw new HttpsError('not-found', 'El usuario no existe.');

      const cambios: Record<string, unknown> = {};
      if (typeof data.nombre === 'string' && data.nombre.trim()) {
        cambios.nombre = data.nombre.trim();
      }
      if (data.rolGlobal !== undefined) {
        if (!ROLES.includes(data.rolGlobal)) {
          throw new HttpsError('invalid-argument', 'Rol global inválido.');
        }
        if (data.uid === UID_ADMIN_BOOTSTRAP && data.rolGlobal !== 'ADMIN') {
          throw new HttpsError('permission-denied', 'El administrador principal no se puede degradar.');
        }
        cambios.rolGlobal = data.rolGlobal;
      }

      let caducaCambio = false;
      let caducaEnEfectiva: string | undefined;
      if (data.caducaEn !== undefined) {
        if (data.uid === UID_ADMIN_BOOTSTRAP && data.caducaEn) {
          throw new HttpsError('permission-denied', 'El administrador principal no caduca.');
        }
        caducaEnEfectiva = normalizarCaducaEn(data.caducaEn);
        cambios.caducaEn = caducaEnEfectiva ?? FieldValue.delete();
        caducaCambio = true;
      }

      if (Object.keys(cambios).length > 0) await ref.set(cambios, { merge: true });
      if (typeof cambios.nombre === 'string') {
        await getAuth().updateUser(data.uid, { displayName: cambios.nombre });
      }
      // Bloqueo inmediato coherente con la fecha (el barrido diario es el respaldo).
      if (caducaCambio) {
        await getAuth()
          .updateUser(data.uid, { disabled: vencido(caducaEnEfectiva) })
          .catch((e) => logger.warn(`updateUser(disabled) falló para ${data.uid}: ${e}`));
      }
      logger.info(`administrarUsuarios: actualizado ${data.uid} por ${callerUid}`);
      return { ok: true };
    }

    // ---- eliminar ----
    if (data.accion === 'eliminar') {
      if (!data.uid) throw new HttpsError('invalid-argument', 'Falta uid.');
      if (data.uid === UID_ADMIN_BOOTSTRAP) {
        throw new HttpsError('permission-denied', 'El administrador principal no se puede eliminar.');
      }
      if (data.uid === callerUid) {
        throw new HttpsError('permission-denied', 'No puedes eliminar tu propia cuenta.');
      }
      await getAuth()
        .deleteUser(data.uid)
        .catch((e) => {
          if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
        });
      await purgarDatosUsuario(data.uid);
      logger.info(`administrarUsuarios: eliminado ${data.uid} por ${callerUid}`);
      return { ok: true };
    }

    throw new HttpsError('invalid-argument', 'Acción desconocida.');
  },
);

/**
 * Barrido diario: deshabilita en Auth las cuentas cuya `caducaEn` ya pasó y
 * re-habilita las que dejaron de estar vencidas. Respaldo autoritativo del
 * bloqueo por caducidad (ventana máx. ~1 h por refresco de token).
 */
export const revisarCaducidades = onSchedule(
  { schedule: 'every 24 hours', region: REGION },
  async () => {
    const snap = await db.collection('usuarios').get();
    let cambios = 0;
    for (const d of snap.docs) {
      const u = d.data() as Usuario;
      const debeDeshabilitar = vencido(u.caducaEn);
      try {
        const auth = await getAuth().getUser(d.id);
        if (auth.disabled !== debeDeshabilitar) {
          await getAuth().updateUser(d.id, { disabled: debeDeshabilitar });
          cambios++;
        }
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/user-not-found') {
          logger.warn(`revisarCaducidades: ${d.id}: ${(e as Error).message}`);
        }
      }
    }
    logger.info(`revisarCaducidades: ${cambios} cuentas ajustadas`);
  },
);
