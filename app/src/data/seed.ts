// Datos de demostración para explorar la app sin tener que importar un PDF.
// No se usa en producción.

import { ahora, aplicarRemoto, repo, uuid } from './repo';
import { asignarMiembro, crearSesion, crearUbicacion, registrarConteo } from './conteoService';
import type { Lote } from '../domain/types';

const CATALOGO: [string, string][] = [
  ['1-10-16-0010', 'PARACETAMOL 500 MG, TABLETA'],
  ['1-10-13-0003', 'ROSUVASTATINA 10 MG'],
  ['1-10-11-0030', 'ACIDO ACETIL SALICILICO 100 MG'],
  ['1-10-29-0170', 'AMITRIPTILINA CLORHIDRATO 10 MG'],
  ['1-10-02-0185', 'AMOXICILINA BASE 500 MG'],
  ['1-10-15-0130', 'ALOPURINOL 300 MG, TABLETAS'],
  ['1-10-07-0160', 'AMIODARONA CLORHIDRATO 200 MG'],
  ['1-00-02-6468', 'CLARITROMICINA JARABE'],
  ['1-10-45-0002', 'ACIDO ACETICO GLACIAL, LITRO'],
  ['1-10-41-0043', 'MICOFENOLATO DE MOFETILO 250 MG'],
];

export function hayDatosDemo(): boolean {
  return repo.sesiones().some((s) => s.nombre.startsWith('[Demo]'));
}

// Todo el sembrado es LOCAL (aplicarRemoto): no se empuja a Firestore para no
// ensuciar la base compartida ni chocar con las reglas (usuarios/conteos ficticios).
export function sembrarDemo() {
  return aplicarRemoto(() => sembrarDemoInterno());
}

function sembrarDemoInterno() {
  const lotes: Lote[] = [];
  for (const [codigo, nombre] of CATALOGO) {
    if (!repo.producto(codigo)) {
      repo.upsertProducto({ codigo, nombre, createdAt: ahora() });
    }
    const lote: Lote = {
      id: uuid(),
      codigoProducto: codigo,
      lote: 'L-2026-0' + ((lotes.length % 7) + 1),
      fechaVencimiento: `2027-0${(lotes.length % 8) + 1}-15`,
      // Un par de ítems marcados como que NO requieren QR (a granel).
      requiereQr: !nombre.includes('LITRO'),
      activo: true,
      createdAt: ahora(),
    };
    repo.upsertLote(lote);
    lotes.push(lote);
  }

  crearUbicacion('Bodega Central - Estante A3');
  crearUbicacion('Bodega Central - Refrigerados');

  // Usuarios ficticios de demo (no son cuentas reales; sirven para ilustrar la
  // triangulación). Sus IDs llevan prefijo 'demo-' para distinguirlos.
  const op1 = { id: 'demo-op1', nombre: '[Demo] Operador 1', rolGlobal: 'OPERADOR' as const };
  const op2 = { id: 'demo-op2', nombre: '[Demo] Operador 2', rolGlobal: 'OPERADOR' as const };
  const aud = { id: 'demo-aud', nombre: '[Demo] Auditor', rolGlobal: 'AUDITOR' as const };
  [op1, op2, aud].forEach((u) => repo.upsertUsuario(u));

  const sesion = crearSesion('[Demo] Inventario Bodega Central', 0.2);
  asignarMiembro(sesion.id, op1.id, 'CONTEO_1');
  asignarMiembro(sesion.id, op2.id, 'CONTEO_2');
  asignarMiembro(sesion.id, aud.id, 'MUESTREO');

  const conQr = lotes.filter((l) => l.requiereQr);
  conQr.forEach((lote, i) => {
    const base = 20 + i * 7;
    // C1 en todos; C2 en la mayoría; algunos coinciden, uno discrepa fuerte.
    registrarConteo({
      sesionId: sesion.id, loteId: lote.id, usuarioId: op1.id,
      rolConteo: 'CONTEO_1', cantidad: base,
    });
    if (i < conQr.length - 2) {
      const c2 = i === 1 ? base + 12 : i === 3 ? base + 1 : base;
      registrarConteo({
        sesionId: sesion.id, loteId: lote.id, usuarioId: op2.id,
        rolConteo: 'CONTEO_2', cantidad: c2,
      });
    }
  });

  return sesion;
}
