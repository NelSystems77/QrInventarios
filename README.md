# QR Inventarios by NelSystems

Sistema de triangulación / doble conteo ciego + generación y reimpresión de etiquetas QR.
Especificación completa en [`especificacion_qr_inventarios_nelsystems_v2.md`](especificacion_qr_inventarios_nelsystems_v2.md).

## Stack

- **Frontend / app:** React 19 + Vite + TypeScript (PWA, pensado para trabajar offline en piso de bodega).
- **Backend:** Firebase — proyecto `qrinventarios-73309`. Auth (correo/contraseña) + Firestore (`nam5`). Reglas en `firestore.rules` (desplegadas).
- **Persistencia:** *local-first*. `src/data/repo.ts` (localStorage) es la fuente de verdad en el dispositivo; `src/data/firestoreSync.ts` sincroniza en ambos sentidos con Firestore (snapshots en vivo + "sink" de escrituras). Los `conteos` además usan la cola offline de `src/data/sync.ts`.
- **Extracción de PDF:** `pdfjs-dist` en el navegador.
- **QR y hoja imprimible:** `qrcode` + `pdf-lib` (layout Avery 5160, 30 etiquetas/hoja carta).
- **PWA:** instalable, con app-shell y assets precacheados para trabajar sin conexión.

## Firebase

| | |
|---|---|
| Project ID | `qrinventarios-73309` |
| Super admin | `admin@nelsystems.com` (UID `dbpxHr426fXCqBaJlaEygxPuEv92`) — se auto-promueve a ADMIN al entrar; gestiona roles en **Administración → Usuarios** |
| Config web | en `src/firebase.ts` (la config web de Firebase no es secreta) |
| Desplegar reglas | `firebase deploy --only firestore:rules` |
| Desplegar app | `cd app && npm run build && cd .. && firebase deploy --only hosting` → `https://qrinventarios-73309.web.app` |

Un usuario nuevo se registra en la pantalla de acceso (rol `OPERADOR` por defecto);
el super admin le cambia el rol y lo asigna a sesiones. Crear cuentas de terceros
sin auto-registro requeriría una Cloud Function con Admin SDK.

## Correr en local

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de producción
npm test           # suite de dominio (Vitest)
```

Se entra con **correo y contraseña** (Firebase Auth). Nuevos usuarios se registran
desde la misma pantalla con rol `OPERADOR`; el super admin los promueve.

## Estado de implementación

| Spec | Módulo | Estado |
|---|---|---|
| 7.1.1–7.1.2 | Importar PDF + previsualización editable | ✅ `features/import` |
| 7.1.3 | Selección de exclusiones (`requiere_qr`) | ✅ preview + `features/labels/CatalogPage` |
| 7.1.4 | Generación de hoja de etiquetas pendientes | ✅ `features/labels/GeneratePage` |
| 7.1.5 / 7.5 | Reimpresión individual con motivo e historial | ✅ `features/labels/ReprintPage` |
| 2.x | Catálogo `productos` / `lotes` (N lotes por producto) | ✅ `domain/types.ts` + `data/repo.ts` |
| 2.2 | Sesiones, ubicaciones, captura de conteos con corrección | ✅ `features/conteo` |
| 2.4 / 3 | Triangulación y consolidado + regla de stock oficial | ✅ `domain/triangulacion.ts` (con tests) |
| 6 | Sync offline: `cliente_uuid` idempotente, vigencia derivada, alerta al auditor | ✅ `domain/sincronizacion.ts` (con tests) |
| 4 | Producto/lote no reconocido → registrar al vuelo sin bloquear | ✅ `features/conteo/CountPage` |
| 5 | Ingreso manual con flag `ingreso_manual` | ✅ `features/conteo/CountPage` |
| 2.3 | Blind count | ✅ a nivel de app **y reforzado en Firestore Rules** (`firestore.rules`, desplegadas) |
| 6.4 | Cola offline + "pendiente de sincronizar" + reintento al reconectar | ✅ `data/sync.ts` (con tests) |
| — | Auth (correo/contraseña) + roles + gestión de usuarios | ✅ `auth/firebaseAuth.ts`, `features/admin/UsersPage` |
| — | Sincronización multi-dispositivo con Firestore | ✅ `data/firestoreSync.ts` (snapshots en vivo + sink) |
| 8 | PWA instalable + shell offline | ✅ `vite-plugin-pwa` |
| — | Layout responsive (piso de bodega = teléfono) | ✅ |
| — | Sync de `conteos`/`alertas`/`filas` acotado a la sesión/importación activa | ✅ `firestoreSync` + `useAmbito` |
| — | Borrado en cascada de sesiones (conteos, miembros, alertas) | ✅ `eliminarSesion` (cliente) + Cloud Function `limpiarSesionEliminada` |
| — | Cloud Functions: vigencia + alertas autoritativas server-side | ✅ **desplegadas** (`consolidarConteos`, `us-central1`, Node 22) |

> Los dispositivos ADMIN/AUDITOR además recalculan `esVigente` y alertas en el
> cliente (respuesta inmediata / offline); la Cloud Function es la versión
> autoritativa y no depende de que nadie tenga la app abierta.

> El PDF de productos se procesa 100% en el navegador y **no se archiva**: solo se
> guardan las filas extraídas (`importaciones_pdf_filas`).

## Sincronización

Patrón *local-first*: `data/repo.ts` (localStorage) es la fuente de verdad en el
dispositivo. `data/firestoreSync.ts` mantiene un espejo bidireccional con Firestore
—snapshots `onSnapshot` bajan los cambios, un *sink* en el repo sube los locales—.
La vigencia de los conteos se **deriva en lectura** (`seleccionarVigentes`), así que
los conteos son *append-only* y no hay reescrituras que compitan entre dispositivos.
La barra lateral muestra **En línea / Sin conexión**, los conteos pendientes, y un
toggle **simular offline** para probar la §6.4.

## Flujo de conteo

1. **Admin** crea una sesión y asigna roles (`CONTEO_1`, `CONTEO_2`, `MUESTREO`) al equipo.
2. Cada **contador** entra a *Escanear y contar*: escanea el QR (o busca manual) → ve
   el detalle → registra la cantidad. Cada conteo lleva `cliente_uuid` + hora local.
3. Si llegan dos versiones para el mismo lote/rol, se conservan ambas y vale la más
   reciente por hora de dispositivo. Si difieren más del umbral de la sesión, se
   crea una **alerta para el Auditor**.
4. `CONTEO_1 ≠ CONTEO_2` sin muestreo ⇒ alerta de triangulación.
5. **Admin/Auditor** ven el **consolidado** con estado de triangulación y stock
   oficial; un contador solo ve su propia columna (blind count). Export a CSV.

## Tests

`npm test` — 35 tests: reglas de dominio (`domain/triangulacion.test.ts`,
`domain/sincronizacion.test.ts`), flujo de la §6 (`data/conteoService.test.ts`),
cola offline y merge multi-dispositivo (`data/sync.test.ts`), parser del PDF CCSS
(`lib/pdf/parsePharmacyPdf.test.ts`).

## Parser del PDF

Validado contra el *Reporte de Productos en Despacho* de la CCSS (`RptSIFA032.rpt`):
**1110/1110 filas** extraídas del PDF de ejemplo. El listado de ejemplo solo trae
código + nombre; lote y vencimiento se completan en la previsualización editable.

## Próximos pasos

1. **Hosting**: `cd app && npm run build && cd .. && firebase deploy --only hosting`
   → `https://qrinventarios-73309.web.app`.

## Cloud Functions (`functions/`) — desplegadas

Proyecto en plan **Blaze**. Node 22, 2ª gen, `us-central1`.

- `consolidarConteos` — `onDocumentWritten('conteos/{id}')`: recalcula `esVigente`
  de todo el grupo y sincroniza las alertas de la sesión. Idempotente, con punto fijo.
- `limpiarSesionEliminada` — `onDocumentDeleted('sesiones/{id}')`: borra en cascada.

La lógica de negocio se comparte con la app: `functions/src/domain/` se **copia**
de `app/src/domain/` en el predeploy (`functions/sync-domain.mjs`). No editar a mano.
Redeploy: `firebase deploy --only functions`.
