import { describe, expect, it } from 'vitest';
import { extraerFilasDeLineas } from './parsePharmacyPdf';

describe('extraerFilasDeLineas — reporte CCSS (RptSIFA032)', () => {
  it('extrae código, presentación y nombre de una fila con columnas numéricas', () => {
    const { filas } = extraerFilasDeLineas([
      '1-10-13-0003 CN ROSUVASTATINA 10 MG COMO ROSU 231.880 512.000 2,388.380',
    ]);
    expect(filas).toEqual([
      {
        codigo: '1-10-13-0003',
        presentacion: 'CN',
        nombre: 'ROSUVASTATINA 10 MG COMO ROSU',
        vencimiento: undefined,
        existencia: 231.88,
        valida: true,
      },
    ]);
  });

  it('maneja cantidades con separador de miles y ceros', () => {
    const { filas } = extraerFilasDeLineas([
      '1-10-16-0010 CN PARACETAMOL 500 MG, TABLETA 551.550 1,700.000 5,011.000',
      '1-00-02-6468 FC CLARITROMICINA JARABE 0.000 0.000 0.000',
    ]);
    expect(filas.map((f) => f.codigo)).toEqual(['1-10-16-0010', '1-00-02-6468']);
    expect(filas[0].nombre).toBe('PARACETAMOL 500 MG, TABLETA');
  });

  it('captura la columna EXISTENCIA (primer valor numérico de la fila)', () => {
    const { filas } = extraerFilasDeLineas([
      '1-10-16-0010 CN PARACETAMOL 500 MG, TABLETA 551.550 1,700.000 5,011.000',
      '1-00-02-6468 FC CLARITROMICINA JARABE 0.000 0.000 0.000',
      '1-10-11-0030 CN ACIDO ACETIL SALICILICO 100 MG. T 443.070 603.000 1,189.700',
    ]);
    expect(filas.map((f) => f.existencia)).toEqual([551.55, 0, 443.07]);
  });

  it('ignora encabezados y pies de página sin código', () => {
    const { filas, descartadas } = extraerFilasDeLineas([
      'CAJA COSTARRICENSE DE SEGURO SOCIAL',
      'PRODUCTO EXISTENCIA CUOTA CONSUMO',
      'Página: 1',
      '1-10-15-0130 CN ALOPURINOL 300 MG. TABLETAS. 62.400 135.000 326.300',
    ]);
    expect(filas).toHaveLength(1);
    expect(descartadas).toHaveLength(0);
  });

  it('deduplica filas repetidas (mismo código y nombre)', () => {
    const linea = '1-10-07-0160 CN AMIODARONA CLORHIDRATO 200 MG 10.260 20.000 46.560';
    const { filas } = extraerFilasDeLineas([linea, linea]);
    expect(filas).toHaveLength(1);
  });

  it('formato alterno sin columnas numéricas: código + nombre + fecha de vencimiento', () => {
    const { filas } = extraerFilasDeLineas([
      '1-10-13-0003 CN ROSUVASTATINA 10 MG 31/12/2027',
    ]);
    expect(filas[0]).toMatchObject({
      codigo: '1-10-13-0003',
      nombre: 'ROSUVASTATINA 10 MG',
      vencimiento: '2027-12-31',
    });
  });

  it('marca inválida una fila cuyo nombre no se pudo leer', () => {
    const { filas } = extraerFilasDeLineas(['1-10-45-0002 LT AB 0.000 0.000 0.000']);
    expect(filas[0].valida).toBe(false);
  });
});
