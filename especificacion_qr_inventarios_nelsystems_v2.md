# Especificación Técnica v2: QR Inventarios by NelSystems
**Sistema de Triangulación, Doble Conteo Ciego y Generación/Reimpresión de Etiquetas QR**

---

## 0. Registro de cambios respecto a v1

| Área | v1 | v2 |
|---|---|---|
| Nombre del proyecto | Inventarios by NelSystems | **QR Inventarios by NelSystems** |
| Producto ↔ Lote | Un solo registro por código (no soporta múltiples lotes) | Tabla `lotes` separada — un producto puede tener N lotes activos |
| Blind Count | Solo protegido por la API | Protegido además por **Row-Level Security (RLS)** en PostgreSQL |
| Vista consolidada | `CROSS JOIN` sin filtrar sesión (crece sin control) | Función parametrizada `fn_consolidado_sesion(sesion_id)` |
| Conflictos offline | No especificado | Estrategia explícita de resolución (sección 6) |
| Generación de QR | No existía | **Módulo nuevo completo** (sección 7): importar PDF, marcar "no requiere QR", imprimir, reimprimir |

---

## 1. Visión General

QR Inventarios by NelSystems ahora cubre dos flujos complementarios:

1. **Flujo de conteo** (ya definido en v1, corregido aquí): triangulación con doble conteo ciego + muestreo de auditoría.
2. **Flujo de etiquetado** (nuevo): a partir de un PDF con el listado de productos de una bodega, el sistema genera las etiquetas QR necesarias, permite excluir productos que no requieren QR (a criterio del usuario), y permite reimprimir cualquier etiqueta individual sin regenerar el lote completo.

```
   PDF de productos
         │
         ▼
 ┌───────────────────┐      ┌─────────────────────┐
 │  IMPORTAR / MAPEAR │ ───▶ │  MARCAR REQUIERE_QR  │
 └───────────────────┘      └──────────┬───────────┘
                                        ▼
                             ┌─────────────────────┐
                             │  GENERAR ETIQUETAS   │
                             │  (PDF imprimible)    │
                             └──────────┬───────────┘
                                        ▼
                             ┌─────────────────────┐
                             │  QR EN EL ÍTEM FÍSICO │
                             └──────────┬───────────┘
                                        ▼
                        (flujo de conteo triangulado v1)
```

---

## 2. Modelo de Datos Corregido (PostgreSQL / DDL)

### 2.1 Catálogo de productos y lotes (separados)

```sql
-- Identidad del producto (código único, sin datos de lote)
CREATE TABLE productos (
    codigo      VARCHAR(50) PRIMARY KEY,   -- Ej: '1-00-02-6468'
    nombre      VARCHAR(150) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Un producto puede tener múltiples lotes con vencimientos distintos
CREATE TABLE lotes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_producto     VARCHAR(50) NOT NULL REFERENCES productos(codigo),
    lote                VARCHAR(50) NOT NULL,
    fecha_vencimiento   DATE,
    requiere_qr         BOOLEAN NOT NULL DEFAULT TRUE, -- el usuario puede excluirlo
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_producto_lote UNIQUE (codigo_producto, lote)
);
```

### 2.2 Sesiones y conteos (con soporte de corrección y ubicación)

```sql
CREATE TABLE sesiones_inventario (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre       VARCHAR(100) NOT NULL,
    estado       VARCHAR(20) DEFAULT 'ACTIVO', -- 'ACTIVO', 'CERRADO'
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ubicaciones (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(100) NOT NULL -- Ej: 'Bodega Central - Estante A3'
);

-- Se quita el UNIQUE duro sobre (sesion, lote, rol): ahora se permite
-- corregir un conteo sin perder trazabilidad, marcando la versión anterior.
CREATE TABLE conteos_inventario (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sesion_id           UUID NOT NULL REFERENCES sesiones_inventario(id),
    lote_id             UUID NOT NULL REFERENCES lotes(id),
    ubicacion_id        UUID REFERENCES ubicaciones(id),
    ubicacion           VARCHAR(100), -- etiqueta libre escrita por el contador (Ej: 'Cámara 1', 'Despacho')
    usuario_id          UUID NOT NULL,
    rol_conteo          VARCHAR(20) NOT NULL CHECK (rol_conteo IN ('CONTEO_1','CONTEO_2','MUESTREO')),
    cantidad            INT NOT NULL CHECK (cantidad >= 0),
    ingreso_manual      BOOLEAN NOT NULL DEFAULT FALSE,
    es_vigente          BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE = corregido/reemplazado
    corrige_conteo_id   UUID REFERENCES conteos_inventario(id), -- si esta versión corrige a otra (trazabilidad)
    cliente_uuid        UUID NOT NULL, -- generado en el dispositivo, para dedupe offline
    fecha_registro_local TIMESTAMP NOT NULL, -- hora del dispositivo al capturar
    fecha_sync          TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- hora del servidor al recibir
    CONSTRAINT uq_cliente_uuid UNIQUE (cliente_uuid)
);

CREATE INDEX idx_conteos_vigentes ON conteos_inventario (sesion_id, lote_id, rol_conteo) WHERE es_vigente = TRUE;
```

### 2.3 Row-Level Security para el blind count

El requisito "Ninguna respuesta hacia CONTEO_2 debe contener las cantidades de CONTEO_1" no puede depender solo de que el endpoint lo filtre bien — se refuerza a nivel de base de datos:

```sql
ALTER TABLE conteos_inventario ENABLE ROW LEVEL SECURITY;

-- Un usuario con rol CONTEO_2 nunca puede LEER filas de rol CONTEO_1
-- (current_setting se define por sesión de conexión desde el backend
--  al autenticar al usuario, según su rol asignado en esa sesión de inventario)
CREATE POLICY blind_count_policy ON conteos_inventario
    FOR SELECT
    USING (
        current_setting('app.rol_usuario', true) IN ('ADMIN', 'AUDITOR')
        OR rol_conteo = current_setting('app.rol_usuario', true)
    );
```

Esto significa que aunque exista un bug en el endpoint, o alguien consulte la base directamente con las credenciales de un operador, físicamente no puede ver los conteos del otro rol.

### 2.4 Vista consolidada como función parametrizada

El `CROSS JOIN` sin filtro de v1 escala mal. Se reemplaza por una función que solo materializa la sesión pedida:

```sql
CREATE OR REPLACE FUNCTION fn_consolidado_sesion(p_sesion_id UUID)
RETURNS TABLE (
    codigo VARCHAR, nombre VARCHAR, lote VARCHAR, fecha_vencimiento DATE,
    cantidad_p1 INT, cantidad_p2 INT, cantidad_p3 INT, estado_triangulacion TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.codigo, p.nombre, l.lote, l.fecha_vencimiento,
        c1.cantidad, c2.cantidad, c3.cantidad,
        CASE
            WHEN c1.cantidad IS NULL OR c2.cantidad IS NULL THEN 'PENDIENTE'
            WHEN c1.cantidad = c2.cantidad THEN 'COINCIDE'
            WHEN c1.cantidad <> c2.cantidad AND c3.cantidad IS NULL THEN 'DISCREPANCIA'
            ELSE 'AUDITADO'
        END
    FROM lotes l
    JOIN productos p ON p.codigo = l.codigo_producto
    LEFT JOIN conteos_inventario c1 ON c1.lote_id = l.id AND c1.sesion_id = p_sesion_id AND c1.rol_conteo = 'CONTEO_1' AND c1.es_vigente
    LEFT JOIN conteos_inventario c2 ON c2.lote_id = l.id AND c2.sesion_id = p_sesion_id AND c2.rol_conteo = 'CONTEO_2' AND c2.es_vigente
    LEFT JOIN conteos_inventario c3 ON c3.lote_id = l.id AND c3.sesion_id = p_sesion_id AND c3.rol_conteo = 'MUESTREO' AND c3.es_vigente;
END;
$$ LANGUAGE plpgsql STABLE;
```

---

## 3. Regla de Stock Oficial (sin cambios de lógica, aplicada sobre `lotes`)

- Si $C_3$ existe → prevalece $C_3$.
- Si $C_1 = C_2$ → prevalece $C_1$.
- Si $C_1 \neq C_2$ y $C_3$ es NULL → estado `PENDIENTE / EN DISPUTA`.

---

## 4. Producto o lote no reconocido en el catálogo

Si se escanea un QR cuyo código no existe en `productos`/`lotes`:

1. El endpoint `/api/v1/scan/parse` responde `404` con un payload que incluye los datos crudos leídos del QR.
2. El frontend ofrece "Registrar producto nuevo" (crea `productos` + `lotes` al vuelo) o "Enviar a revisión" (cola `productos_pendientes_revision` para que un Admin decida después).
3. Nunca se bloquea al operador en el piso de bodega — siempre hay una salida.

---

## 5. Ingreso manual (fallback sin QR legible)

Ya cubierto en v1 con el flag `ingreso_manual`, ahora movido a `conteos_inventario` (sección 2.2) en lugar de ser un campo suelto sin tabla.

---

## 6. Estrategia de Sincronización Offline

**Problema a resolver:** dos operadores pueden registrar conteos para el mismo lote/rol mientras ambos están sin conexión, y sincronizar en momentos distintos.

**Estrategia elegida: UUID generado en cliente + timestamp local, sin sobrescritura silenciosa.**

1. Cada conteo se crea en el dispositivo con un `cliente_uuid` (UUID v4) y `fecha_registro_local`. Esto hace que reenviar el mismo registro dos veces (por reintento de red) sea idempotente gracias a `uq_cliente_uuid`.
2. Cuando llegan al servidor **dos conteos distintos** para el mismo `(sesion_id, lote_id, rol_conteo)`:
   - El servidor **no descarta ninguno**. Inserta ambos.
   - Marca como `es_vigente = TRUE` el de `fecha_registro_local` más reciente, y pone `es_vigente = FALSE` en el otro.
   - Esto es diferente de "last-write-wins" ciego: se preserva el historial completo para auditoría, solo cambia cuál cuenta como el conteo activo.
3. Si la diferencia de cantidad entre las dos versiones es mayor a un umbral configurable (ej. 20%), se genera automáticamente una alerta para el Auditor (P3) — probablemente no fue un simple "toqué mal el número", sino un conteo genuinamente distinto que vale la pena revisar antes de confiar en el más reciente.
4. La app cliente debe mostrar claramente "Pendiente de sincronizar" vs "Sincronizado" para que el operador sepa si su conteo ya quedó registrado.

---

## 7. Módulo Nuevo: Generación y Reimpresión de QR desde PDF

### 7.1 Flujo funcional

1. **Importar PDF** — el usuario selecciona un PDF con el listado de productos de la bodega (tabla con código, nombre, lote, vencimiento).
2. **Mapeo y previsualización** — el sistema extrae la tabla del PDF y muestra una vista previa editable antes de confirmar la importación (evita que un PDF mal formateado corrompa el catálogo).
3. **Selección de exclusiones** — el usuario marca, ítem por ítem o por selección masiva, cuáles productos **no requieren QR** (ej. artículos a granel, insumos que no se auditan individualmente). Esto se guarda en `lotes.requiere_qr`.
4. **Generación de etiquetas** — el sistema genera un PDF imprimible con una etiqueta QR por cada lote con `requiere_qr = TRUE` que aún no tenga etiqueta impresa.
5. **Reimpresión individual** — en cualquier momento, buscar un producto/lote específico (por código, nombre o escaneando su QR dañado) y reimprimir solo esa etiqueta, sin regenerar el lote completo. Queda registro de quién reimprimió, cuándo y por qué motivo.

### 7.2 Modelo de datos del módulo

```sql
CREATE TABLE importaciones_pdf (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_archivo VARCHAR(200),
    usuario_id    UUID NOT NULL,
    estado        VARCHAR(20) DEFAULT 'PENDIENTE_REVISION', -- 'PENDIENTE_REVISION','CONFIRMADA','DESCARTADA'
    fecha_importacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Filas extraídas del PDF antes de confirmarlas contra el catálogo real
CREATE TABLE importaciones_pdf_filas (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    importacion_id    UUID REFERENCES importaciones_pdf(id),
    codigo_extraido   VARCHAR(50),
    nombre_extraido   VARCHAR(150),
    lote_extraido     VARCHAR(50),
    vencimiento_extraido DATE,
    fila_valida       BOOLEAN DEFAULT TRUE, -- FALSE si el parser no pudo leerla bien
    lote_id_resultante UUID REFERENCES lotes(id) -- se llena al confirmar
);

CREATE TABLE etiquetas_qr (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id         UUID NOT NULL REFERENCES lotes(id) UNIQUE,
    payload_qr      TEXT NOT NULL, -- el JSON exacto codificado en el QR
    veces_impreso   INT NOT NULL DEFAULT 0,
    ultima_impresion TIMESTAMP,
    activo          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE historial_impresiones (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etiqueta_id  UUID NOT NULL REFERENCES etiquetas_qr(id),
    usuario_id   UUID NOT NULL,
    motivo       VARCHAR(30) NOT NULL, -- 'INICIAL','DANADA','EXTRAVIADA','RE-ETIQUETADO'
    fecha        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7.3 Endpoints nuevos

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/v1/importaciones/pdf` | Sube el PDF y dispara la extracción de tabla |
| `GET` | `/api/v1/importaciones/{id}/preview` | Devuelve las filas extraídas para revisión/edición |
| `POST` | `/api/v1/importaciones/{id}/confirmar` | Inserta las filas confirmadas en `productos`/`lotes` |
| `PATCH` | `/api/v1/lotes/{id}/requiere-qr` | Marca un lote como excluido o incluido de generación de QR |
| `POST` | `/api/v1/qr/generar-pendientes` | Genera el PDF imprimible con todas las etiquetas pendientes (`requiere_qr=TRUE` y sin imprimir) |
| `POST` | `/api/v1/qr/reimprimir/{lote_id}` | Regenera e imprime una sola etiqueta, exige `motivo` |
| `GET` | `/api/v1/qr/historial/{lote_id}` | Historial completo de impresiones de una etiqueta |

### 7.4 Stack técnico adicional para este módulo

* **Extracción de tabla del PDF:** `pdfplumber` (Python, vía microservicio) o `pdf-parse` + heurística de columnas en Node — recomiendo `pdfplumber` porque maneja mejor tablas con bordes irregulares, que es lo típico en listados exportados de sistemas de farmacia/ERP.
* **Generación de QR:** librería `qrcode` (Node) o `qrcode` (Python) — el payload codificado debe ser exactamente el mismo JSON que ya definiste en la sección 2 de v1, para que el mismo lector sirva tanto para conteo como para verificación de impresión.
* **Composición de la hoja de etiquetas imprimible:** `pdf-lib` o Puppeteer (HTML → PDF) — soporta layouts tipo Avery (ej. grillas de 30 etiquetas por hoja carta), con código + nombre + lote + vencimiento impresos junto al QR para lectura humana de respaldo.

### 7.5 Reglas de negocio del módulo

- Un lote nunca puede tener más de una etiqueta activa (`UNIQUE` en `etiquetas_qr.lote_id`) — reimprimir actualiza `veces_impreso` y `ultima_impresion`, no crea una etiqueta nueva.
- Cambiar `requiere_qr` de `TRUE` a `FALSE` en un lote que ya tiene etiqueta impresa marca la etiqueta como `activo = FALSE`, pero **no la borra** (trazabilidad).
- Toda reimpresión exige un `motivo` explícito — esto evita que "reimprimir por si acaso" se vuelva la norma y genere QR duplicados circulando en la bodega.

---

## 8. Criterios de Aceptación Actualizados (DoD)

- [ ] Rendimiento: "Escanear QR → Mostrar Detalle → Registrar Cantidad" en menos de 4 segundos.
- [ ] Blind Count Inviolable, garantizado por API **y por RLS** en base de datos.
- [ ] Sincronización offline con resolución de conflictos por versión (sección 6), nunca sobrescritura silenciosa.
- [ ] Ingreso manual con indicador `ingreso_manual: true`.
- [ ] Un mismo producto soporta múltiples lotes activos simultáneamente.
- [ ] Importación de PDF con previsualización editable antes de confirmar contra el catálogo real.
- [ ] El usuario puede excluir productos individuales de la generación de QR.
- [ ] Cualquier etiqueta QR es reimprimible individualmente, con motivo e historial completo.
