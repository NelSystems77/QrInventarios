# Etiquetas QR de muestra

15 códigos QR para probar el flujo de conteo. La lista de productos
se define en `app/scripts/generar-muestras.mjs`.

## Archivos

- `qr-NN-<codigo>.png` — un QR por producto (imprimir o mostrar en pantalla y escanear)
- `muestras-hoja.pdf` — las 15 en una hoja carta para imprimir

## Para que la app reconozca estos QR

En la app (como Admin) → **Sesiones → "Cargar 15 lotes de muestra"**. Eso crea en
el catálogo los 15 productos/lotes con los mismos IDs que llevan los QR. Después,
al escanear cualquiera, la app muestra el producto y pide la cantidad.

Sin ese paso, la app tratará el QR como "no reconocido" (y ofrecerá registrarlo al vuelo).

## Productos incluidos

01. `1-10-16-0010` — PARACETAMOL 500 MG, TABLETA
02. `1-10-09-0020` — ACETAZOLAMIDA 250 MG. TABLETAS
03. `1-10-11-0030` — ACIDO ACETIL SALICILICO 100 MG. T
04. `1-10-41-0043` — MICOFENOLATO DE MOFETILO 250
05. `1-10-04-0045` — ABACAVIR 600 MG (COMO SULFATO) C
06. `1-10-04-0046` — ACICLOVIR 400 MG. TABLETAS O TAB
07. `1-10-42-0070` — ACIDO ASCORBICO 500 MG. O ACIDO
08. `1-10-13-0080` — ACIDO FOLICO 1 MG, TABLETAS RANU
09. `1-10-50-0085` — FOLINATO (COMO SAL CALCICA)15 M
10. `1-10-46-0089` — ACITRETINA 25 MG, CÁPSULA.
11. `1-10-28-0090` — VALPROATO SEMISODICO EQUIVALE
12. `1-10-32-0095` — ACIDO URSODEOXICOLICO 250 MG, C
13. `1-10-42-0100` — ALFACALCIDOL 0.25 MCG CAPSULAS D
14. `1-10-42-0110` — ALFACALCIDOL 1 MCG. CAPSULAS DE
15. `1-10-15-0130` — ALOPURINOL 300 MG. TABLETAS.
