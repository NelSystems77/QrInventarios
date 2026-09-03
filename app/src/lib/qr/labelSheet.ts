// Composición de la hoja de etiquetas imprimible (spec 7.4).
// Layout tipo Avery 5160 (30 etiquetas por hoja carta): QR + código, nombre,
// lote y vencimiento impresos al lado para lectura humana de respaldo.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

export interface EtiquetaImprimible {
  payload: string; // JSON serializado que va dentro del QR
  codigo: string;
  nombre: string;
  lote: string;
  vencimiento?: string;
}

interface LayoutAvery {
  cols: number;
  rows: number;
  pageW: number;
  pageH: number;
  marginX: number;
  marginTop: number;
  labelW: number;
  labelH: number;
  gutterX: number;
  gutterY: number;
}

// Avery 5160 en puntos PDF (1 pulgada = 72 pt), hoja US Letter 8.5 x 11.
const AVERY_5160: LayoutAvery = {
  cols: 3,
  rows: 10,
  pageW: 612,
  pageH: 792,
  marginX: 13.5, // 0.1875"
  marginTop: 36, // 0.5"
  labelW: 189, // 2.625"
  labelH: 72, // 1"
  gutterX: 9, // 0.125"
  gutterY: 0,
};

const PT = 72;

async function qrPng(texto: string, sizePx: number): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(texto, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: sizePx,
  });
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : texto.slice(0, max - 1) + '…';
}

export async function generarHojaEtiquetas(
  etiquetas: EtiquetaImprimible[],
  layout: LayoutAvery = AVERY_5160,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const porHoja = layout.cols * layout.rows;

  for (let i = 0; i < etiquetas.length; i++) {
    if (i % porHoja === 0) {
      doc.addPage([layout.pageW, layout.pageH]);
    }
    const page = doc.getPages()[doc.getPageCount() - 1];
    const et = etiquetas[i];
    const idx = i % porHoja;
    const col = idx % layout.cols;
    const row = Math.floor(idx / layout.cols);

    const x = layout.marginX + col * (layout.labelW + layout.gutterX);
    const yTop =
      layout.pageH - layout.marginTop - row * (layout.labelH + layout.gutterY);
    const yBottom = yTop - layout.labelH;

    const pad = 6;
    const qrSide = layout.labelH - pad * 2;
    const png = await qrPng(et.payload, 240);
    const img = await doc.embedPng(png);
    page.drawImage(img, {
      x: x + pad,
      y: yBottom + pad,
      width: qrSide,
      height: qrSide,
    });

    const textX = x + pad + qrSide + 6;
    const textW = layout.labelW - (pad + qrSide + 6) - pad;
    const maxChars = Math.floor(textW / 4.6);
    let ty = yTop - pad - 8;

    page.drawText(recortar(et.codigo, maxChars), {
      x: textX,
      y: ty,
      size: 8,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    ty -= 10;
    for (const linea of envolver(et.nombre, maxChars).slice(0, 2)) {
      page.drawText(linea, { x: textX, y: ty, size: 6.5, font, color: rgb(0.1, 0.1, 0.1) });
      ty -= 8;
    }
    page.drawText(recortar(`Lote: ${et.lote}`, maxChars), {
      x: textX,
      y: ty,
      size: 6.5,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    ty -= 8;
    if (et.vencimiento) {
      page.drawText(recortar(`Vence: ${et.vencimiento}`, maxChars), {
        x: textX,
        y: ty,
        size: 6.5,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  return doc.save();
}

/** Etiqueta individual centrada en una página pequeña (reimpresión, spec 7.1.5). */
export async function generarEtiquetaIndividual(
  et: EtiquetaImprimible,
): Promise<Uint8Array> {
  return generarHojaEtiquetas([et], {
    cols: 1,
    rows: 1,
    pageW: 3 * PT,
    pageH: 1.5 * PT,
    marginX: 6,
    marginTop: 6,
    labelW: 3 * PT - 12,
    labelH: 1.5 * PT - 12,
    gutterX: 0,
    gutterY: 0,
  });
}

function envolver(texto: string, maxChars: number): string[] {
  const palabras = texto.split(/\s+/);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    if ((actual + ' ' + p).trim().length > maxChars) {
      if (actual) lineas.push(actual);
      actual = p;
    } else {
      actual = (actual + ' ' + p).trim();
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}
