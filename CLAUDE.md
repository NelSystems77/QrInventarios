# CLAUDE.md — QR Inventarios by NelSystems

Guía para trabajar en este repo. Especificación funcional completa:
`especificacion_qr_inventarios_nelsystems_v2.md`. Estado y decisiones: `README.md`.

## Qué es

Dos flujos:
1. **Conteo** — doble conteo ciego triangulado (CONTEO_1 / CONTEO_2 / MUESTREO) +
   regla de stock oficial + sincronización offline sin sobrescritura.
2. **Etiquetado** — importar PDF de productos → excluir ítems → generar hoja de
   etiquetas QR → reimprimir individualmente.

## Stack

React 19 + Vite + TS, PWA (`vite-plugin-pwa`). **Local-first**: `localStorage`
(`data/repo.ts`) es la fuente de verdad en el dispositivo, con espejo bidireccional
a **Firebase** (Auth correo/contraseña + Firestore, proyecto `qrinventarios-73309`)
vía `data/firestoreSync.ts`. Reglas en `firestore.rules` (desplegadas). Super admin:
`admin@nelsystems.com` / UID `dbpxHr426fXCqBaJlaEygxPuEv92`.

Todo el código de la app está en `app/`. Ejecutar comandos desde `app/`.
`firebase deploy --only firestore:rules` desde la raíz.

```
npm run dev     # http://localhost:5173
npm test        # Vitest — reglas de dominio (no requiere navegador)
npm run build   # tsc -b && vite build (+ genera el service worker)
```

## Arquitectura

| Capa | Ubicación | Rol |
|---|---|---|
| Dominio (puro, testeado) | `src/domain/` | `triangulacion.ts` (§2.4, §3), `sincronizacion.ts` (§6 + `seleccionarVigentes`), `reconciliacion.ts` (Stock SIFA vs físico), `types.ts` |
| Repositorio local | `src/data/repo.ts` | fuente de verdad en el dispositivo; **toda** la persistencia pasa por aquí. `set`/`del` internos disparan el *sink* |
| Casos de uso | `src/data/service.ts` (etiquetas), `src/data/conteoService.ts` (conteo) | |
| Sincronización | `src/data/firestoreSync.ts` (espejo Firestore ↔ repo; `conteos`/`alertas`/`filas` acotados a la sesión/importación activa vía `useAmbito`) · `src/data/sync.ts` (`RemoteSync` + cola offline) | |
| Cloud Functions | `functions/` (raíz) — `consolidarConteos`, `limpiarSesionEliminada` (desplegadas); `administrarUsuarios` (onCall: CRUD de cuentas con Admin SDK), `revisarCaducidades` (onSchedule: deshabilita cuentas vencidas). Blaze, Node 22, us-central1. `functions/src/domain/` es copia de `app/src/domain/` (predeploy) | |
| Firebase | `src/firebase.ts` (init) · `src/auth/firebaseAuth.ts` (auth + `useSesion`/`useUsuarioActual`) | |
| UI | `src/features/{auth,conteo,import,labels,admin}/` | páginas; `src/components/` compartidos |
| PDF / QR | `src/lib/pdf/`, `src/lib/qr/` | `pdfjs-dist`, `qrcode`, `pdf-lib` |

### Reglas de oro

- **No accedas a `localStorage` ni a Firestore desde la UI.** Todo dato entra y
  sale por `repo`. `firestoreSync` conecta repo ↔ Firestore; la UI no lo toca.
- Escrituras que vienen de Firestore se aplican con `repo`-interno bajo
  `aplicarRemoto(...)` para no reenviarlas (evita el bucle eco).
- Reactividad: los componentes llaman `useRepo()` (o `useSync()`); `repo.version()`
  cambia en cada escritura. `useMemo` que dependa de datos del repo debe incluir
  ese número en las deps.
- Lógica de negocio nueva → función pura en `src/domain/` **con test**. Si la
  necesita la Cloud Function, añádela al copiado de `functions/sync-domain.mjs`.
- **Alcance de la sesión**: una `SesionInventario` puede llevar `importacionId`. Si lo
  tiene, `lotesDeSesion()` (en `conteoService.ts`) acota progreso/consolidado/escaneo a
  los lotes de esa importación (`Lote.importacionId`, denormalizado para que lo vean los
  contadores) más los registrados al vuelo (§4). Sin `importacionId` (sesiones demo /
  antiguas) cae al catálogo global — comportamiento del spec (`fn_consolidado_sesion`).
  El Admin liga la importación al crear la sesión o desde la tarjeta «Preparación de la
  sesión» (`SessionPage`), que también importa el PDF y genera la hoja de QR acotada.
- **Conteos son append-only** para los contadores. La vigencia (`esVigente`) se
  deriva en lectura con `seleccionarVigentes()`; la Cloud Function la escribe de
  forma autoritativa cuando está desplegada. Corregir un conteo = documento nuevo.
- Alertas: `reevaluarAlertasSesion()` (idempotente, no cierra ninguna) se llama al
  registrar un conteo y —en dispositivos privilegiados— al llegar conteos por sync.
- Blind count: la UI filtra en `conteoService.conteosVisibles()` y las queries de
  `firestoreSync` lo acotan; `firestore.rules` lo hace inviolable. No lo debilites.
- Textos de UI en español (es-CR). Sin librería de estilos: CSS plano en
  `src/index.css` con variables `--*`.
- **Stock SIFA vs Stock físico**: el dominio sigue llamando `stockOficial` al
  resultado triangulado del §3 (usado por la Cloud Function), pero la UI lo
  muestra como **"Stock físico"**. El **"Stock SIFA"** es la columna EXISTENCIA
  del reporte RptSIFA032 que un Admin carga en la sesión (`guardarStockSifa`,
  colección `stock_sifa` acotada a la sesión activa, solo Admin/Auditor). El
  consolidado tiene una vista "Stock SIFA vs físico" (`reconciliacionDeSesion` →
  `construirReconciliacion`). El mismo parser (`parsePharmacyPdf`) sirve para
  etiquetas y para SIFA; ahora también extrae `existencia`.

## Datos de demostración

`SessionsPage` (como Admin) → "Cargar datos de demostración" (`src/data/seed.ts`).
Todo el sembrado es **local** (`aplicarRemoto`): no se sube a Firestore ni choca
con las reglas (usa usuarios/conteos ficticios `demo-*`). "Borrar todo" resetea
solo el repo local.

## Auth y roles

`admin@nelsystems.com` (UID de bootstrap) se auto-promueve a ADMIN. **Cualquier
ADMIN** ve *Administración → Usuarios* (`features/admin/UsersPage.tsx`) y desde ahí
crea cuentas, cambia el rol global, fija `caducaEn` o elimina, todo vía la Cloud
Function `administrarUsuarios` (Admin SDK; la UI ya no escribe `usuarios` directo).
La cuenta de bootstrap es "principal": no se puede eliminar, degradar ni caducar.
Quien se registra nace `OPERADOR`. Un `OPERADOR` solo cuenta en las sesiones donde
un ADMIN lo asignó con un rol (`CONTEO_1/2`, `MUESTREO`).

**Caducidad**: `Usuario.caducaEn` ('YYYY-MM-DD'). El login la rechaza
(`alIniciarSesion`), `firestore.rules` (`vigente()`) le quita poderes, y
`revisarCaducidades` (diaria) deshabilita la cuenta en Auth. `administrarUsuarios`
además aplica `disabled` de inmediato al cambiar la fecha.
