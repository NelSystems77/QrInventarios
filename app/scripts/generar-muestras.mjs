// Genera 15 etiquetas QR de muestra a partir de ejemploParaQr.pdf para pruebas.
//
// Salidas:
//   muestras/qr-NN-<codigo>.png     — un PNG por producto
//   muestras/muestras-hoja.pdf      — hoja imprimible con las 15
//   muestras/README.md              — instrucciones
//   app/src/data/muestras.json      — datos para el botón "cargar lotes de muestra"
//
// Ejecutar:  node app/scripts/generar-muestras.mjs   (desde la raíz del repo)

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// app/scripts/ -> raíz del repo son dos niveles arriba
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(root, 'muestras');
mkdirSync(OUT, { recursive: true });

const CANTIDAD = 15;
const NOMBRE_MAX = 60;

// ── 1. Extraer productos del PDF (mismo criterio que app/src/lib/pdf) ──
const data = new Uint8Array(readFileSync(join(root, 'ejemploParaQr.pdf')));
const pdf = await getDocument({ data }).promise;
const lineas = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const content = await (await pdf.getPage(p)).getTextContent();
  const items = content.items
    .filter((it) => 'str' in it && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  let cur = null;
  for (const it of items) {
    if (!cur || Math.abs(cur.y - it.y) > 2.5) {
      cur = { y: it.y, parts: [it] };
      lineas.push(cur);
    } else cur.parts.push(it);
  }
}
const RE = /(\d-\d{2}-\d{2}-\d{4})\s+([A-Z]{2})\s+(.+?)\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s*$/;
const vistos = new Set();
const productos = [];
for (const l of lineas) {
  const txt = l.parts
    .sort((a, b) => a.x - b.x)
    .map((p) => p.s)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = txt.match(RE);
  if (!m) continue;
  const codigo = m[1];
  const nombre = m[3].replace(/[.,;:\s]+$/, '').trim();
  if (vistos.has(codigo) || nombre.length < 4) continue;
  vistos.add(codigo);
  productos.push({ codigo, nombre });
  if (productos.length === CANTIDAD) break;
}

// ── 2. Construir registros + payload QR (idéntico a app/src/lib/qr/payload.ts) ──
const registros = productos.map((p, i) => {
  const loteId = `muestra-${p.codigo}`;
  const payload = JSON.stringify({
    v: 2,
    t: 'lote',
    cod: p.codigo,
    nom: p.nombre.slice(0, NOMBRE_MAX),
    lot: 'MUESTRA',
    lid: loteId,
  });
  return { n: i + 1, codigo: p.codigo, nombre: p.nombre, lote: 'MUESTRA', loteId, payload };
});

// ── 3. PNG por etiqueta ──
for (const r of registros) {
  const nn = String(r.n).padStart(2, '0');
  await QRCode.toFile(join(OUT, `qr-${nn}-${r.codigo}.png`), r.payload, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

// ── 4. Hoja imprimible (3 columnas x 5 filas, carta) ──
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage([612, 792]);
const cols = 3;
const rows = 5;
const mx = 36;
const my = 40;
const cw = (612 - mx * 2) / cols;
const ch = (792 - my * 2) / rows;

for (let i = 0; i < registros.length; i++) {
  const r = registros[i];
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = mx + col * cw;
  const yTop = 792 - my - row * ch;

  const png = await QRCode.toDataURL(r.payload, { width: 240, margin: 1 });
  const img = await doc.embedPng(Buffer.from(png.split(',')[1], 'base64'));
  const qr = 92;
  page.drawImage(img, { x: x + (cw - qr) / 2, y: yTop - qr - 8, width: qr, height: qr });

  const lineasTxt = [
    `#${String(r.n).padStart(2, '0')}  ${r.codigo}`,
    ...envolver(r.nombre, 26).slice(0, 2),
    'Lote: MUESTRA',
  ];
  let ty = yTop - qr - 20;
  for (let j = 0; j < lineasTxt.length; j++) {
    page.drawText(lineasTxt[j], {
      x: x + 6,
      y: ty,
      size: j === 0 ? 8 : 7,
      font: j === 0 ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    ty -= 9;
  }
}
writeFileSync(join(OUT, 'muestras-hoja.pdf'), await doc.save());

// ── 5. Datos para la app + README ──
writeFileSync(
  join(root, 'app', 'src', 'data', 'muestras.json'),
  JSON.stringify(
    registros.map(({ codigo, nombre, lote, loteId }) => ({ codigo, nombre, lote, loteId })),
    null,
    2,
  ) + '\n',
);

writeFileSync(
  join(OUT, 'README.md'),
  `# Etiquetas QR de muestra

15 códigos QR generados desde \`ejemploParaQr.pdf\` para probar el flujo de conteo.

## Archivos

- \`qr-NN-<codigo>.png\` — un QR por producto (imprimir o mostrar en pantalla y escanear)
- \`muestras-hoja.pdf\` — las 15 en una hoja carta para imprimir

## Para que la app reconozca estos QR

En la app (como Admin) → **Sesiones → "Cargar 15 lotes de muestra"**. Eso crea en
el catálogo los 15 productos/lotes con los mismos IDs que llevan los QR. Después,
al escanear cualquiera, la app muestra el producto y pide la cantidad.

Sin ese paso, la app tratará el QR como "no reconocido" (y ofrecerá registrarlo al vuelo).

## Productos incluidos

${registros.map((r) => `${String(r.n).padStart(2, '0')}. \`${r.codigo}\` — ${r.nombre}`).join('\n')}
`,
);

console.log(`OK — ${registros.length} muestras en ${OUT}`);

function envolver(texto, max) {
  const out = [];
  let cur = '';
  for (const w of texto.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
