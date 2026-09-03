import { describe, expect, it } from 'vitest';
import { evaluarAlertasSesion } from './alertas';
import type { Conteo } from './types';

let n = 0;
function c(over: Partial<Conteo>): Conteo {
  return {
    id: `c${n++}`,
    sesionId: 's1',
    loteId: 'l1',
    usuarioId: 'u1',
    rolConteo: 'CONTEO_1',
    cantidad: 0,
    ingresoManual: false,
    esVigente: true,
    clienteUuid: `cu${n}`,
    fechaRegistroLocal: '2026-09-02T10:00:00Z',
    estadoSync: 'SINCRONIZADO',
    ...over,
  };
}

describe('evaluarAlertasSesion', () => {
  it('sin conteos, sin alertas', () => {
    expect(evaluarAlertasSesion([], 0.2)).toEqual([]);
  });

  it('C1 = C2: ninguna alerta', () => {
    const r = evaluarAlertasSesion(
      [
        c({ rolConteo: 'CONTEO_1', cantidad: 10 }),
        c({ rolConteo: 'CONTEO_2', cantidad: 10 }),
      ],
      0.2,
    );
    expect(r).toEqual([]);
  });

  it('C1 ≠ C2 sin muestreo: alerta de triangulación', () => {
    const r = evaluarAlertasSesion(
      [
        c({ rolConteo: 'CONTEO_1', cantidad: 10 }),
        c({ rolConteo: 'CONTEO_2', cantidad: 15 }),
      ],
      0.2,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ loteId: 'l1', tipo: 'DISCREPANCIA_TRIANGULACION' });
  });

  it('dos versiones de C1 muy distintas: alerta de versiones', () => {
    const r = evaluarAlertasSesion(
      [
        c({ rolConteo: 'CONTEO_1', cantidad: 100, fechaRegistroLocal: '2026-09-02T09:00:00Z' }),
        c({ rolConteo: 'CONTEO_1', cantidad: 50, fechaRegistroLocal: '2026-09-02T11:00:00Z' }),
      ],
      0.2,
    );
    expect(r.some((a) => a.tipo === 'DISCREPANCIA_VERSIONES')).toBe(true);
  });

  it('separa alertas por lote', () => {
    const r = evaluarAlertasSesion(
      [
        c({ loteId: 'lA', rolConteo: 'CONTEO_1', cantidad: 10 }),
        c({ loteId: 'lA', rolConteo: 'CONTEO_2', cantidad: 12 }),
        c({ loteId: 'lB', rolConteo: 'CONTEO_1', cantidad: 5 }),
        c({ loteId: 'lB', rolConteo: 'CONTEO_2', cantidad: 5 }),
      ],
      0.2,
    );
    expect(r.map((a) => a.loteId)).toEqual(['lA']);
  });
});
