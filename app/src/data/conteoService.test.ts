import { beforeEach, describe, expect, it } from 'vitest';
import { repo, uuid } from './repo';
import {
  asignarMiembro,
  consolidadoDeSesion,
  crearSesion,
  registrarConteo,
  viewerDeSesion,
} from './conteoService';
import { seleccionarVigentes } from '../domain/sincronizacion';
import type { Lote, Producto, Usuario } from '../domain/types';

function seedProductoLote(codigo: string): Lote {
  const p: Producto = { codigo, nombre: `Producto ${codigo}`, createdAt: 'x' };
  repo.upsertProducto(p);
  const l: Lote = {
    id: uuid(),
    codigoProducto: codigo,
    lote: '—',
    requiereQr: true,
    activo: true,
    createdAt: 'x',
  };
  repo.upsertLote(l);
  return l;
}

let admin: Usuario;
let op1: Usuario;
let op2: Usuario;

beforeEach(() => {
  repo.reset();
  admin = { id: uuid(), nombre: 'Admin', rolGlobal: 'ADMIN' };
  op1 = { id: uuid(), nombre: 'Op1', rolGlobal: 'OPERADOR' };
  op2 = { id: uuid(), nombre: 'Op2', rolGlobal: 'OPERADOR' };
  [admin, op1, op2].forEach((u) => repo.upsertUsuario(u));
});

describe('registrarConteo — dedupe offline (spec 6.1)', () => {
  it('reenviar el mismo clienteUuid es idempotente', () => {
    const s = crearSesion('S');
    const l = seedProductoLote('1-00-00-0001');
    const cu = uuid();
    const a = registrarConteo({
      sesionId: s.id,
      loteId: l.id,
      usuarioId: op1.id,
      rolConteo: 'CONTEO_1',
      cantidad: 10,
      clienteUuid: cu,
    });
    const b = registrarConteo({
      sesionId: s.id,
      loteId: l.id,
      usuarioId: op1.id,
      rolConteo: 'CONTEO_1',
      cantidad: 10,
      clienteUuid: cu,
    });
    expect(b.duplicado).toBe(true);
    expect(b.conteo.id).toBe(a.conteo.id);
    expect(repo.conteosDeSesion(s.id)).toHaveLength(1);
  });
});

describe('registrarConteo — versiones en conflicto (spec 6.2/6.3)', () => {
  it('guarda ambas versiones y marca vigente la más reciente', () => {
    const s = crearSesion('S');
    const l = seedProductoLote('1-00-00-0002');
    registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op1.id, rolConteo: 'CONTEO_1',
      cantidad: 10, fechaRegistroLocal: '2026-09-02T09:00:00Z',
    });
    registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op2.id, rolConteo: 'CONTEO_1',
      cantidad: 11, fechaRegistroLocal: '2026-09-02T10:00:00Z',
    });
    const todos = repo.conteosDeSesion(s.id);
    expect(todos).toHaveLength(2); // append-only: no se descarta ninguno
    const vigentes = seleccionarVigentes(todos);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0].cantidad).toBe(11); // vigencia derivada por hora de dispositivo
  });

  it('diferencia sobre el umbral genera alerta para el auditor', () => {
    const s = crearSesion('S', 0.2);
    const l = seedProductoLote('1-00-00-0003');
    registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op1.id, rolConteo: 'CONTEO_1',
      cantidad: 100, fechaRegistroLocal: '2026-09-02T09:00:00Z',
    });
    const r = registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op2.id, rolConteo: 'CONTEO_1',
      cantidad: 60, fechaRegistroLocal: '2026-09-02T10:00:00Z',
    });
    expect(r.alertas.some((a) => a.tipo === 'DISCREPANCIA_VERSIONES')).toBe(true);
    expect(repo.alertasDeSesion(s.id).length).toBeGreaterThanOrEqual(1);
  });
});

describe('triangulación y consolidado (spec 2.4 / 3)', () => {
  it('C1 ≠ C2 sin muestreo => alerta + estado DISCREPANCIA + sin stock oficial', () => {
    const s = crearSesion('S');
    const l = seedProductoLote('1-00-00-0004');
    registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op1.id, rolConteo: 'CONTEO_1', cantidad: 10 });
    const r = registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op2.id, rolConteo: 'CONTEO_2', cantidad: 13 });
    expect(r.alertas.some((a) => a.tipo === 'DISCREPANCIA_TRIANGULACION')).toBe(true);

    const view = consolidadoDeSesion(s.id, { usuarioId: admin.id, rolGlobal: 'ADMIN' });
    const fila = view.find((f) => f.loteId === l.id)!;
    expect(fila.estadoTriangulacion).toBe('DISCREPANCIA');
    expect(fila.stockOficial).toBeNull();
    expect(fila.estadoStock).toBe('EN_DISPUTA');
  });

  it('C1 = C2 => stock oficial = C1', () => {
    const s = crearSesion('S');
    const l = seedProductoLote('1-00-00-0005');
    registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op1.id, rolConteo: 'CONTEO_1', cantidad: 42 });
    registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op2.id, rolConteo: 'CONTEO_2', cantidad: 42 });
    const fila = consolidadoDeSesion(s.id, { usuarioId: admin.id, rolGlobal: 'ADMIN' }).find((f) => f.loteId === l.id)!;
    expect(fila.estadoTriangulacion).toBe('COINCIDE');
    expect(fila.stockOficial).toBe(42);
  });
});

describe('blind count a nivel de app (spec 2.3)', () => {
  it('un CONTEO_2 no ve los conteos de CONTEO_1 en el consolidado', () => {
    const s = crearSesion('S');
    asignarMiembro(s.id, op1.id, 'CONTEO_1');
    asignarMiembro(s.id, op2.id, 'CONTEO_2');
    const l = seedProductoLote('1-00-00-0006');
    registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op1.id, rolConteo: 'CONTEO_1', cantidad: 10 });
    registrarConteo({ sesionId: s.id, loteId: l.id, usuarioId: op2.id, rolConteo: 'CONTEO_2', cantidad: 12 });

    const viewerOp2 = viewerDeSesion(s.id, op2.id);
    const fila = consolidadoDeSesion(s.id, viewerOp2).find((f) => f.loteId === l.id)!;
    expect(fila.cantidadP2).toBe(12);
    expect(fila.cantidadP1).toBeNull();
    expect(fila.stockOficial).toBeNull();
  });
});
