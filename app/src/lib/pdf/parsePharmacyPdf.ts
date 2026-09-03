// Extracción de la tabla de productos desde un PDF de listado de bodega/farmacia.
//
// Diseñado y validado contra el "Reporte de Productos en Despacho" de la CCSS
// (RptSIFA032.rpt): 1110/1110 filas del PDF de ejemplo se extraen correctamente.
//
// Formato de fila típico:
//   1-10-13-0003 CN ROSUVASTATINA 10 MG COMO ROSU   231.880 512.000 2,388.380
//   └─ código    └pres └─ nombre ─────────────────┘ └── existencia/cuota/consumo ─┘
//
// El listado de ejemplo NO trae lote ni vencimiento; el parser los deja vacíos y
// el usuario los completa en la previsualización editable (spec 7.1.2).

import { pdfjsLib } from './pdfjs';

export interface FilaExtraida {
  codigo: string;
  presentacion?: string;
  nombre: string;
  lote?: string;
  vencimiento?: string;
  valida: boolean;
}

export interface ResultadoExtraccion {
  filas: FilaExtraida[];
  paginas: number;
  /** Líneas que parecían contener un código pero no se pudieron interpretar. */
  descartadas: string[];
}

const CODIGO = /\d-\d{2}-\d{2}-\d{4}/;
// código + presentación (2 letras) + nombre (lazy) + 3 columnas numéricas al final
const FILA_CON_CANTIDADES =
  /(\d-\d{2}-\d{2}-\d{4})\s+([A-Z]{2})\s+(.+?)\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s*$/;
// variante sin columnas numéricas (otros exportes): código + [pres?] + nombre
const FILA_SIMPLE = /^(\d-\d{2}-\d{2}-\d{4})\s+(?:([A-Z]{2})\s+)?(.+?)\s*$/;
// fecha dd/mm/yyyy o dd-mm-yyyy embebida en la línea (posible vencimiento)
const FECHA = /\b(\d{2})[/-](\d{2})[/-](\d{4})\b/;

function agruparEnLineas(
  items: { x: number; y: number; s: string }[],
): string[] {
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: { y: number; partes: typeof items }[] = [];
  let actual: { y: number; partes: typeof items } | null = null;
  for (const it of orden) {
    if (!actual || Math.abs(actual.y - it.y) > 2.5) {
      actual = { y: it.y, partes: [it] };
      grupos.push(actual);
    } else {
      actual.partes.push(it);
    }
  }
  return grupos.map((g) =>
    g.partes
      .sort((a, b) => a.x - b.x)
      .map((p) => p.s)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function normalizarNombre(nombre: string): string {
  return nombre.replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim();
}

function isoDesdeFecha(m: RegExpMatchArray): string {
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

export async function parsePharmacyPdf(
  data: ArrayBuffer,
): Promise<ResultadoExtraccion> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const lineasPorPagina: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown[])
      .filter(
        (it): it is { str: string; transform: number[] } =>
          typeof it === 'object' &&
          it !== null &&
          'str' in it &&
          'transform' in it &&
          !!(it as { str: string }).str.trim(),
      )
      .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }));
    lineasPorPagina.push(...agruparEnLineas(items));
  }

  const { filas, descartadas } = extraerFilasDeLineas(lineasPorPagina);
  return { filas, paginas: pdf.numPages, descartadas };
}

/** Núcleo del parser: de líneas de texto a filas de producto. Testeable sin PDF. */
export function extraerFilasDeLineas(lineas: string[]): {
  filas: FilaExtraida[];
  descartadas: string[];
} {
  const filas: FilaExtraida[] = [];
  const descartadas: string[] = [];
  const vistos = new Set<string>();

  for (const linea of lineas) {
    if (!CODIGO.test(linea)) continue;

    const conCant = linea.match(FILA_CON_CANTIDADES);
    const m = conCant ?? linea.match(FILA_SIMPLE);
    if (!m) {
      descartadas.push(linea);
      continue;
    }

    const codigo = m[1];
    const presentacion = m[2] || undefined;
    let nombre = normalizarNombre(m[3] ?? '');
    let vencimiento: string | undefined;

    // Si NO venían columnas numéricas, una fecha en la línea puede ser el vencimiento.
    if (!conCant) {
      const f = nombre.match(FECHA);
      if (f) {
        vencimiento = isoDesdeFecha(f);
        nombre = normalizarNombre(nombre.replace(FECHA, ''));
      }
    }

    const clave = `${codigo}|${nombre}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    filas.push({
      codigo,
      presentacion,
      nombre,
      vencimiento,
      valida: nombre.length >= 3,
    });
  }

  return { filas, descartadas };
}
