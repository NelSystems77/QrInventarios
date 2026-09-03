import { beforeEach, describe, expect, it } from 'vitest';
import { repo, uuid } from './repo';
import { crearSesion, registrarConteo } from './conteoService';
import {
  configurarRemote,
  conteosPendientes,
  esperarSync,
  setSimularOffline,
  sincronizarSesion,
} from './sync';
import { demoRemote } from './demoRemote';
import { seleccionarVigentes } from '../domain/sincronizacion';
import type { Lote, Usuario } from '../domain/types';

function seedLote(): Lote {
  const l: Lote = {
    id: uuid(),
    codigoProducto: '1-00-00-9999',
    lote: '—',
    requiereQr: true,
    activo: true,
    createdAt: 'x',
  };
  repo.upsertProducto({ codigo: l.codigoProducto, nombre: 'X', createdAt: 'x' });
  repo.upsertLote(l);
  return l;
}

let op: Usuario;

beforeEach(async () => {
  await esperarSync();
  repo.reset();
  localStorage.removeItem('qr-inventarios/servidor-demo/v1');
  configurarRemote(demoRemote);
  await setSimularOffline(false);
  op = { id: uuid(), nombre: 'Op', rolGlobal: 'OPERADOR' };
  repo.upsertUsuario(op);
});

describe('cola offline (spec 6.4)', () => {
  it('sin conexión, el conteo queda PENDIENTE de sincronizar', async () => {
    await setSimularOffline(true);
    const s = crearSesion('S');
    const l = seedLote();
    const r = registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op.id, rolConteo: 'CONTEO_1', cantidad: 5,
    });
    expect(r.conteo.estadoSync).toBe('PENDIENTE');
    expect(conteosPendientes(s.id)).toHaveLength(1);
  });

  it('al volver la conexión y sincronizar, se empuja y queda SINCRONIZADO', async () => {
    await setSimularOffline(true);
    const s = crearSesion('S');
    const l = seedLote();
    registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op.id, rolConteo: 'CONTEO_1', cantidad: 5,
    });
    expect(conteosPendientes(s.id)).toHaveLength(1);

    await setSimularOffline(false);
    await sincronizarSesion(s.id);

    expect(conteosPendientes(s.id)).toHaveLength(0);
    expect(repo.conteosDeSesion(s.id)[0].estadoSync).toBe('SINCRONIZADO');

    const enServidor = await demoRemote.pull(s.id);
    expect(enServidor).toHaveLength(1);
    expect(enServidor[0].cantidad).toBe(5);
  });

  it('traer conteos de otro dispositivo desde el remoto y resolver vigencia', async () => {
    await setSimularOffline(true); // evita que el empuje en segundo plano corra antes
    const s = crearSesion('S');
    const l = seedLote();
    registrarConteo({
      sesionId: s.id, loteId: l.id, usuarioId: op.id, rolConteo: 'CONTEO_1',
      cantidad: 5, fechaRegistroLocal: '2026-01-01T00:00:00Z',
    });
    // "Dispositivo B" ya subió un conteo al servidor, más reciente.
    await demoRemote.push([
      {
        id: uuid(), sesionId: s.id, loteId: l.id, usuarioId: 'otro',
        rolConteo: 'CONTEO_1', cantidad: 99, ingresoManual: false, esVigente: true,
        clienteUuid: uuid(), fechaRegistroLocal: '2999-01-01T00:00:00Z',
        estadoSync: 'SINCRONIZADO',
      },
    ]);

    await setSimularOffline(false);
    await sincronizarSesion(s.id);

    const vigente = seleccionarVigentes(repo.conteosDeSesion(s.id))[0];
    expect(vigente.cantidad).toBe(99); // el más reciente por hora de dispositivo
    expect(repo.conteosDeSesion(s.id)).toHaveLength(2); // ninguno se descarta
  });
});
