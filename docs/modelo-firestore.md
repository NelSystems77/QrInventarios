# Modelo de datos en Firestore

> **Estado:** conectado. Proyecto `qrinventarios-73309`, Auth correo/contraseña y
> Firestore activos, `firestore.rules` desplegadas. Sincronización en
> `app/src/data/firestoreSync.ts` — snapshots de `conteos`/`alertas`/`importaciones_filas`
> **acotados** a la sesión/importación activa (`setSesionActiva` / `setImportacionActiva`).
> Colecciones **planas** (todas de nivel superior; `miembros` con id `<sesionId>__<uid>`).
>
> **Cloud Functions:** DESPLEGADAS (plan Blaze, Node 22, 2ª gen, `us-central1`).
> `consolidarConteos` escribe `esVigente` y las alertas de forma autoritativa;
> `limpiarSesionEliminada` hace la cascada. Los dispositivos ADMIN/AUDITOR además
> recalculan en el cliente (`onConteosSesion` → `reevaluarAlertasSesion`) para
> respuesta inmediata / offline, y `eliminarSesion` borra en cascada desde el
> cliente del Admin (la Function cubre el resto).
>
> **Índices:** ninguno compuesto es necesario hoy — las consultas usan solo filtros
> de igualdad (`sesionId ==`, `usuarioId ==`, `importacionId ==`), que Firestore
> resuelve con índices de un campo. Harán falta si se añade `orderBy` o rangos.
>
> El PDF de productos NO se archiva: se procesa en el navegador y solo se guardan
> las filas extraídas.

La app es **local-first**: `app/src/data/repo.ts` (hoy sobre `localStorage`) es la
fuente de verdad en el dispositivo. Firestore será el backend de sincronización,
no un reemplazo directo del repo. El punto de integración ya existe:
`app/src/data/sync.ts` define la interfaz `RemoteSync` (`push` / `pull` /
`disponible`). Migrar = implementar esa interfaz con Firestore y llamar
`configurarRemote(firestoreRemote)` en `main.tsx` (hoy usa `demoRemote`).

## Colecciones

| Colección | Doc ID | Campos clave | Notas |
|---|---|---|---|
| `productos/{codigo}` | código | `nombre`, `presentacion` | catálogo, escritura Admin |
| `lotes/{loteId}` | uuid | `codigoProducto`, `lote`, `fechaVencimiento`, `requiereQr`, `activo` | `uq_producto_lote` → validar en Rules o Function |
| `importaciones_pdf/{id}` | uuid | `nombreArchivo`, `estado`, `usuarioId` | |
| `importaciones_pdf/{id}/filas/{filaId}` | uuid | filas extraídas | subcolección |
| `etiquetas_qr/{loteId}` | **loteId** | `payloadQr`, `vecesImpreso`, `ultimaImpresion`, `activo` | doc ID = loteId ⇒ 1 etiqueta por lote (spec 7.5) |
| `etiquetas_qr/{loteId}/impresiones/{id}` | uuid | `usuarioId`, `motivo`, `fecha` | historial |
| `usuarios/{uid}` | Firebase Auth uid | `nombre`, `rolGlobal` | |
| `sesiones/{sesionId}` | uuid | `nombre`, `estado`, `umbralDiscrepancia` | |
| `sesiones/{sesionId}/miembros/{uid}` | uid | `rol` (`CONTEO_1`/`CONTEO_2`/`MUESTREO`) | **base del blind count** |
| `sesiones/{sesionId}/conteos/{conteoId}` | uuid | `loteId`, `rolConteo`, `cantidad`, `esVigente`, `clienteUuid`, `fechaRegistroLocal`, `ingresoManual` | |
| `sesiones/{sesionId}/ubicaciones/{id}` | uuid | `nombre` | |
| `sesiones/{sesionId}/alertas/{id}` | uuid | `tipo`, `detalle`, `cantidades`, `atendida` | solo Admin/Auditor |
| `stock_sifa/{sesionId__codigo}` | `<sesionId>__<codigo>` | `sesionId`, `codigo`, `existencia`, `nombreReporte`, `archivo`, `fechaCarga` | existencia del sistema (reporte RptSIFA032) por sesión; escribe Admin, lee Admin/Auditor; snapshot acotado a la sesión activa. Se compara con el stock físico triangulado en la vista de reconciliación del consolidado |

## Blind count (spec 2.3) — reforzado en Security Rules

Regla: un miembro con `rol == CONTEO_2` **no puede leer** documentos de
`sesiones/{s}/conteos` cuyo `rolConteo == 'CONTEO_1'` (y viceversa). Admin y
Auditor leen todo. Ver [`firestore.rules`](../firestore.rules). Esto reemplaza el
`current_setting('app.rol_usuario')` de PostgreSQL: el rol se lee de
`sesiones/{s}/miembros/{uid}` dentro de la propia regla con `get()`.

La app ya aplica el mismo filtro en `conteoService.conteosVisibles()` para no
mostrar de más; las Rules lo hacen inviolable.

## Estrategia de escritura de conteos (spec 6)

- `clienteUuid` es único por conteo (generado en el dispositivo). Reintentos =
  idempotentes: al sincronizar se busca si ya existe un doc con ese `clienteUuid`.
- **Nunca** se sobrescribe: dos versiones para el mismo `(sesión, lote, rol)` se
  guardan ambas; `esVigente` marca la más reciente por `fechaRegistroLocal`.
- El recálculo de `esVigente` por grupo y la generación de alertas se pueden hacer:
  - **client-side** tras cada `pull` (como hoy en `sync.ts`), o
  - en una **Cloud Function** `onWrite` sobre `conteos` (más robusto multi-device).
  Recomendado: Function para el recálculo de vigencia + alertas; el cliente sigue
  calculando localmente para respuesta inmediata offline.

## Auth

`app/src/auth/localAuth.ts` es un stub con la misma forma que tendrá el wrapper de
Firebase Auth (`usuarioActual()`, `login`, `logout`, `subscribe`). Sustituir por
`onAuthStateChanged` + un doc `usuarios/{uid}` para el `rolGlobal`.

## Orden sugerido de migración

1. `firebase init` (Firestore + Auth + Hosting + Functions). Proyecto + `firebaseConfig`.
2. Implementar `auth/firebaseAuth.ts` (misma interfaz que `localAuth`).
3. Implementar `data/firestoreRemote.ts` (`RemoteSync`) para `conteos`.
4. Desplegar `firestore.rules`.
5. Mover catálogo / etiquetas / importaciones a Firestore (lecturas directas con
   listeners; el repo local pasa a caché).
6. Cloud Function para vigencia + alertas.
7. Hosting + PWA (ya configurada en `vite.config.ts`).
