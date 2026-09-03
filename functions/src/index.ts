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
import { getFirestore } from 'firebase-admin/firestore';
import {
  onDocumentDeleted,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { evaluarAlertasSesion } from './domain/alertas';
import { seleccionarVigentes } from './domain/sincronizacion';
import type { Conteo } from './domain/types';

initializeApp();
const db = getFirestore();

const REGION = 'us-central1';

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
