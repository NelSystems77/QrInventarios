// Genera las etiquetas QR de muestra para probar el flujo de conteo.
//
// Salidas:
//   muestras/qr-NN-<codigo>.png     — un PNG por producto
//   muestras/muestras-hoja.pdf      — hoja imprimible con todas
//   muestras/README.md              — instrucciones
//   app/src/data/muestras.json      — datos para el botón "cargar lotes de muestra"
//
// Ejecutar:  node app/scripts/generar-muestras.mjs   (desde la raíz del repo)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// app/scripts/ -> raíz del repo son dos niveles arriba
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(root, 'muestras');
mkdirSync(OUT, { recursive: true });

const NOMBRE_MAX = 60;

// ── 1. Catálogo de muestra (código + nombre tal como se registran en la app) ──
// Editar esta lista para cambiar qué productos llevan QR de muestra.
const productos = [
  ['1-10-16-0010', 'PARACETAMOL 500 MG, TABLETA'],
  ['1-10-09-0020', 'ACETAZOLAMIDA 250 MG. TABLETAS'],
  ['1-10-11-0030', 'ACIDO ACETIL SALICILICO 100 MG. T'],
  ['1-10-41-0043', 'MICOFENOLATO DE MOFETILO 250'],
  ['1-10-04-0045', 'ABACAVIR 600 MG (COMO SULFATO) C'],
  ['1-10-04-0046', 'ACICLOVIR 400 MG. TABLETAS O TAB'],
  ['1-10-42-0070', 'ACIDO ASCORBICO 500 MG. O ACIDO'],
  ['1-10-13-0080', 'ACIDO FOLICO 1 MG, TABLETAS RANU'],
  ['1-10-50-0085', 'FOLINATO (COMO SAL CALCICA)15 M'],
  ['1-10-46-0089', 'ACITRETINA 25 MG, CÁPSULA.'],
  ['1-10-28-0090', 'VALPROATO SEMISODICO EQUIVALE'],
  ['1-10-32-0095', 'ACIDO URSODEOXICOLICO 250 MG, C'],
  ['1-10-42-0100', 'ALFACALCIDOL 0.25 MCG CAPSULAS D'],
  ['1-10-42-0110', 'ALFACALCIDOL 1 MCG. CAPSULAS DE'],
  ['1-10-15-0130', 'ALOPURINOL 300 MG. TABLETAS.'],
].map(([codigo, nombre]) => ({ codigo, nombre }));

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

${registros.length} códigos QR para probar el flujo de conteo. La lista de productos
se define en \`app/scripts/generar-muestras.mjs\`.

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
