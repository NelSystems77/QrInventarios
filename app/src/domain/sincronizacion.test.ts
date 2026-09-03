import { describe, expect, it } from 'vitest';
import {
  agruparConteos,
  detectarDiscrepanciaVersiones,
  resolverVigenciaGrupo,
} from './sincronizacion';
import type { Conteo } from './types';

function c(over: Partial<Conteo>): Conteo {
  return {
    id: Math.random().toString(36).slice(2),
    sesionId: 's1',
    loteId: 'l1',
    usuarioId: 'u1',
    rolConteo: 'CONTEO_1',
    cantidad: 0,
    ingresoManual: false,
    esVigente: true,
    clienteUuid: Math.random().toString(36).slice(2),
    fechaRegistroLocal: '2026-09-02T10:00:00Z',
    estadoSync: 'SINCRONIZADO',
    ...over,
  };
}

describe('resolverVigenciaGrupo (spec 6.2)', () => {
  it('marca vigente el de fechaRegistroLocal más reciente, sin descartar el otro', () => {
    const viejo = c({ id: 'viejo', fechaRegistroLocal: '2026-09-02T09:00:00Z', cantidad: 10 });
    const nuevo = c({ id: 'nuevo', fechaRegistroLocal: '2026-09-02T11:00:00Z', cantidad: 8 });
    const r = resolverVigenciaGrupo([viejo, nuevo]);
    expect(r).toHaveLength(2); // ninguno se descarta
    expect(r.find((x) => x.id === 'nuevo')!.esVigente).toBe(true);
    expect(r.find((x) => x.id === 'viejo')!.esVigente).toBe(false);
  });

  it('no es last-write-wins por orden de llegada: gana la hora del dispositivo', () => {
    // "nuevo" llega después pero fue capturado antes -> no debe ganar
    const capturadoAntes = c({ id: 'a', fechaRegistroLocal: '2026-09-02T09:00:00Z' });
    const capturadoDespues = c({ id: 'b', fechaRegistroLocal: '2026-09-02T10:00:00Z' });
    const r = resolverVigenciaGrupo([capturadoDespues, capturadoAntes]);
    expect(r.find((x) => x.id === 'b')!.esVigente).toBe(true);
  });

  it('un solo conteo queda vigente', () => {
    const r = resolverVigenciaGrupo([c({ id: 'x' })]);
    expect(r[0].esVigente).toBe(true);
  });
});

describe('detectarDiscrepanciaVersiones (spec 6.3)', () => {
  const umbral = 0.2;
  it('null si solo hay una versión', () => {
    expect(detectarDiscrepanciaVersiones([c({})], umbral)).toBeNull();
  });
  it('null si las dos versiones más recientes son iguales', () => {
    const g = [
      c({ cantidad: 10, fechaRegistroLocal: '2026-09-02T09:00:00Z' }),
      c({ cantidad: 10, fechaRegistroLocal: '2026-09-02T10:00:00Z' }),
    ];
    expect(detectarDiscrepanciaVersiones(g, umbral)).toBeNull();
  });
  it('null si la diferencia está bajo el umbral', () => {
    const g = [
      c({ cantidad: 100, fechaRegistroLocal: '2026-09-02T09:00:00Z' }),
      c({ cantidad: 90, fechaRegistroLocal: '2026-09-02T10:00:00Z' }),
    ];
    expect(detectarDiscrepanciaVersiones(g, umbral)).toBeNull();
  });
  it('alerta si la diferencia supera el umbral', () => {
    const g = [
      c({ cantidad: 100, fechaRegistroLocal: '2026-09-02T09:00:00Z' }),
      c({ cantidad: 70, fechaRegistroLocal: '2026-09-02T10:00:00Z' }),
    ];
    const d = detectarDiscrepanciaVersiones(g, umbral);
    expect(d).not.toBeNull();
    expect(d!.cantidades).toEqual([100, 70]);
    expect(d!.diferenciaRelativa).toBeCloseTo(0.3, 5);
  });
});

describe('agruparConteos', () => {
  it('separa por sesión, lote y rol', () => {
    const m = agruparConteos([
      c({ rolConteo: 'CONTEO_1' }),
      c({ rolConteo: 'CONTEO_2' }),
      c({ rolConteo: 'CONTEO_1', loteId: 'l2' }),
    ]);
    expect(m.get('s1|l1|CONTEO_1')).toHaveLength(1);
    expect(m.get('s1|l1|CONTEO_2')).toHaveLength(1);
    expect(m.get('s1|l2|CONTEO_1')).toHaveLength(1);
  });
});
