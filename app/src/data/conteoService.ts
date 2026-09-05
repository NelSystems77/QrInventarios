// Casos de uso del flujo de conteo triangulado (spec 2–3, 6).

import type {
  AlertaAuditoria,
  Conteo,
  FilaConsolidado,
  FilaReconciliacion,
  Lote,
  MiembroSesion,
  RolConteo,
  RolGlobal,
  SesionInventario,
  Ubicacion,
} from '../domain/types';
import { construirReconciliacion } from '../domain/reconciliacion';
import {
  agruparConteos,
  claveGrupo,
  seleccionarVigentes,
} from '../domain/sincronizacion';
import { cantidadesDeLote, construirConsolidado, estadoTriangulacion } from '../domain/triangulacion';
import { evaluarAlertasSesion } from '../domain/alertas';
import { ahora, enLote, repo, uuid } from './repo';
import { estadoSyncInicial, sincronizarSesion } from './sync';

export const UMBRAL_DISCREPANCIA_DEFAULT = 0.2; // 20% (spec 6.3)

export interface Viewer {
  usuarioId: string;
  rolGlobal: RolGlobal;
  /** Rol del usuario dentro de la sesión, si es contador. */
  rolConteo?: RolConteo;
}

const esPrivilegiado = (v: Viewer) =>
  v.rolGlobal === 'ADMIN' || v.rolGlobal === 'AUDITOR';

// ───────────────────────── Sesiones ─────────────────────────

export function crearSesion(
  nombre: string,
  umbral = UMBRAL_DISCREPANCIA_DEFAULT,
  importacionId?: string,
): SesionInventario {
  const s: SesionInventario = {
    id: uuid(),
    nombre,
    estado: 'ACTIVO',
    fechaInicio: ahora(),
    umbralDiscrepancia: umbral,
    ...(importacionId ? { importacionId } : {}),
  };
  repo.upsertSesion(s);
  return s;
}

export function cerrarSesion(sesionId: string) {
  const s = repo.sesion(sesionId);
  if (s) repo.upsertSesion({ ...s, estado: 'CERRADO' });
}

/**
 * Liga una sesión a la importación de PDF que define su lista de productos. Se
 * usa cuando la importación se confirma después de haber creado la sesión (flujo
 * de "Preparación" en la página de la sesión).
 */
export function vincularImportacion(sesionId: string, importacionId: string) {
  const s = repo.sesion(sesionId);
  if (s) repo.upsertSesion({ ...s, importacionId });
}

/**
 * Lotes que conforman una sesión. Si la sesión está ligada a una importación,
 * son los lotes de esa importación; si no (sesiones demo / antiguas), todo el
 * catálogo activo.
 *
 * Con `incluirContados`, añade además los lotes que ya tienen algún conteo en la
 * sesión aunque no pertenezcan a la importación — cubre las altas al vuelo de la
 * spec §4 (producto/lote no reconocido registrado durante el conteo).
 */
export function lotesDeSesion(
  sesionId: string,
  opts: { incluirContados?: boolean } = {},
): Lote[] {
  const s = repo.sesion(sesionId);
  if (!s?.importacionId) return repo.lotesActivos();

  const base = repo.lotesDeImportacion(s.importacionId);
  if (!opts.incluirContados) return base;

  const ids = new Set(base.map((l) => l.id));
  const extra: Lote[] = [];
  for (const c of repo.conteosDeSesion(sesionId)) {
    if (ids.has(c.loteId)) continue;
    ids.add(c.loteId);
    const l = repo.lote(c.loteId);
    if (l) extra.push(l);
  }
  return extra.length ? [...base, ...extra] : base;
}

/** ID determinista de la membresía — permite a las Rules resolver el rol con get(). */
export const miembroId = (sesionId: string, usuarioId: string) =>
  `${sesionId}__${usuarioId}`;

export function asignarMiembro(
  sesionId: string,
  usuarioId: string,
  rol: RolConteo,
): MiembroSesion {
  const m: MiembroSesion = {
    id: miembroId(sesionId, usuarioId),
    sesionId,
    usuarioId,
    rol,
  };
  repo.upsertMiembro(m);
  return m;
}

/**
 * Borra asignaciones de sesión inválidas: docs `miembros` sin `usuarioId` (los
 * `<sesionId>__undefined` que generó un bug antiguo al asignar rol con el id de
 * usuario sin resolver). Solo mira el campo `usuarioId`, así que es seguro
 * aunque el catálogo de usuarios aún no haya terminado de sincronizar.
 * Idempotente; solo tiene efecto donde hay permiso para escribir `miembros`
 * (ADMIN/AUDITOR). Devuelve cuántos borró.
 */
export function purgarMiembrosHuerfanos(sesionId: string): number {
  const huerfanos = repo
    .miembrosDeSesion(sesionId)
    .filter((m) => !m.usuarioId);
  if (huerfanos.length === 0) return 0;
  enLote(() => {
    for (const m of huerfanos) repo.eliminarDoc('miembros', m.id);
  });
  return huerfanos.length;
}

export function crearUbicacion(nombre: string): Ubicacion {
  const u: Ubicacion = { id: uuid(), nombre };
  repo.upsertUbicacion(u);
  return u;
}

/**
 * Sugerencias de ubicación para el campo del conteo: las ubicaciones que un Admin
 * predefinió más las que ya se han escrito en conteos de esta sesión. Sirve para
 * alimentar un <datalist>; el contador también puede escribir una nueva.
 */
export function ubicacionesSugeridas(sesionId: string): string[] {
  const set = new Set<string>();
  for (const u of repo.ubicaciones()) {
    if (u.nombre.trim()) set.add(u.nombre.trim());
  }
  for (const c of repo.conteosDeSesion(sesionId)) {
    if (c.ubicacion?.trim()) set.add(c.ubicacion.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

export function viewerDeSesion(sesionId: string, usuarioId: string): Viewer {
  const usuario = repo.usuario(usuarioId);
  const miembro = repo.miembro(sesionId, usuarioId);
  return {
    usuarioId,
    rolGlobal: usuario?.rolGlobal ?? 'OPERADOR',
    rolConteo: miembro?.rol,
  };
}

// ───────────────────────── Registro de conteo ─────────────────────────

export interface EntradaConteo {
  sesionId: string;
  loteId: string;
  ubicacionId?: string;
  /** Ubicación física escrita/elegida por el contador (Ej: 'Cámara 1'). Opcional. */
  ubicacion?: string;
  usuarioId: string;
  rolConteo: RolConteo;
  cantidad: number;
  ingresoManual?: boolean;
  /** Id del conteo que esta versión corrige (trazabilidad de la corrección). */
  corrigeConteoId?: string;
  clienteUuid?: string;
  fechaRegistroLocal?: string;
}

export interface ResultadoConteo {
  conteo: Conteo;
  duplicado: boolean;
  alertas: AlertaAuditoria[];
}

/**
 * Registra un conteo aplicando la estrategia offline de la sección 6:
 * dedupe idempotente por `clienteUuid`, sin sobrescritura silenciosa, recálculo
 * de vigencia por grupo y alerta al auditor si dos versiones divergen demasiado.
 */
export function registrarConteo(entrada: EntradaConteo): ResultadoConteo {
  const clienteUuid = entrada.clienteUuid ?? uuid();

  const yaExiste = repo.conteoPorClienteUuid(clienteUuid);
  if (yaExiste) {
    return { conteo: yaExiste, duplicado: true, alertas: [] };
  }

  if (entrada.cantidad < 0 || !Number.isFinite(entrada.cantidad)) {
    throw new Error('La cantidad debe ser un entero ≥ 0');
  }

  const sesion = repo.sesion(entrada.sesionId);
  if (!sesion) throw new Error('Sesión no encontrada');
  if (sesion.estado === 'CERRADO') throw new Error('La sesión está cerrada');

  const ubicacion = entrada.ubicacion?.trim() || undefined;

  const nuevo: Conteo = {
    id: uuid(),
    sesionId: entrada.sesionId,
    loteId: entrada.loteId,
    ubicacionId: entrada.ubicacionId,
    ubicacion,
    usuarioId: entrada.usuarioId,
    rolConteo: entrada.rolConteo,
    cantidad: Math.trunc(entrada.cantidad),
    ingresoManual: entrada.ingresoManual ?? false,
    esVigente: true,
    corrigeConteoId: entrada.corrigeConteoId,
    clienteUuid,
    fechaRegistroLocal: entrada.fechaRegistroLocal ?? ahora(),
    fechaSync: undefined,
    estadoSync: estadoSyncInicial(),
  };

  // Append-only: no se reescribe la vigencia de nadie (spec 6.2). Se deriva en lectura.
  repo.guardarConteos([nuevo]);

  // Re-evalúa alertas de la sesión (idempotente). La versión autoritativa la hace
  // además la Cloud Function; aquí es para feedback inmediato y trabajo offline.
  const alertas = reevaluarAlertasSesion(entrada.sesionId).filter(
    (a) => a.loteId === nuevo.loteId,
  );

  // Empuje en segundo plano si hay red; si no, queda en la cola PENDIENTE.
  void sincronizarSesion(entrada.sesionId);

  return { conteo: nuevo, duplicado: false, alertas };
}

function crearAlerta(
  sesionId: string,
  loteId: string,
  tipo: AlertaAuditoria['tipo'],
  detalle: string,
  cantidades: number[],
): AlertaAuditoria {
  // Evita duplicar una alerta abierta del mismo tipo para el mismo lote.
  const abierta = repo
    .alertasDeSesion(sesionId)
    .find((a) => a.loteId === loteId && a.tipo === tipo && !a.atendida);

  // Sin cambios respecto a la alerta abierta: no reescribir (evita writes en bucle).
  if (
    abierta &&
    abierta.detalle === detalle &&
    JSON.stringify(abierta.cantidades) === JSON.stringify(cantidades)
  ) {
    return abierta;
  }

  const alerta: AlertaAuditoria = {
    id: abierta?.id ?? uuid(),
    sesionId,
    loteId,
    tipo,
    detalle,
    cantidades,
    fechaCreacion: abierta?.fechaCreacion ?? ahora(),
    atendida: false,
  };
  repo.upsertAlerta(alerta);
  return alerta;
}

/**
 * Recalcula todas las alertas abiertas de una sesión a partir de sus conteos.
 * Idempotente: reutiliza la alerta abierta existente (mismo lote+tipo) y no
 * cierra ninguna — eso lo decide el auditor con "Atender".
 */
export function reevaluarAlertasSesion(sesionId: string): AlertaAuditoria[] {
  const sesion = repo.sesion(sesionId);
  if (!sesion) return [];
  const deseadas = evaluarAlertasSesion(
    repo.conteosDeSesion(sesionId),
    sesion.umbralDiscrepancia,
  );
  return deseadas.map((d) =>
    crearAlerta(sesionId, d.loteId, d.tipo, d.detalle, d.cantidades),
  );
}

export function atenderAlerta(alertaId: string) {
  const a = repo.alerta(alertaId);
  if (a) repo.upsertAlerta({ ...a, atendida: true });
}

// ───────────────────────── Stock SIFA (existencias del sistema) ─────────────────────────

export interface FilaSifaImportada {
  codigo: string;
  nombre: string;
  existencia?: number;
}

export interface ResultadoCargaSifa {
  guardados: number;
  /** Filas cuyo código no está en el catálogo de productos. */
  ignorados: number;
  /** Filas sin columna EXISTENCIA legible. */
  sinExistencia: number;
}

/**
 * Carga las existencias del sistema (columna EXISTENCIA de un reporte RptSIFA032)
 * para una sesión. Solo se guardan las de códigos que conforman la sesión (los
 * lotes de su importación, más los registrados al vuelo). Reemplaza cualquier
 * carga anterior de la sesión, para que volver a subir un reporte corregido quede limpio.
 */
export function guardarStockSifa(
  sesionId: string,
  filas: FilaSifaImportada[],
  archivo?: string,
): ResultadoCargaSifa {
  if (!repo.sesion(sesionId)) throw new Error('Sesión no encontrada');

  let guardados = 0;
  let ignorados = 0;
  let sinExistencia = 0;
  const fechaCarga = ahora();
  // Solo se guardan existencias de códigos que conforman esta sesión.
  const codigosSesion = new Set(
    lotesDeSesion(sesionId, { incluirContados: true }).map((l) => l.codigoProducto),
  );

  enLote(() => {
    repo.borrarStockSifaDeSesion(sesionId);
    for (const f of filas) {
      if (f.existencia === undefined || !Number.isFinite(f.existencia)) {
        sinExistencia++;
        continue;
      }
      if (!codigosSesion.has(f.codigo)) {
        ignorados++;
        continue;
      }
      repo.upsertStockSifa({
        id: repo.stockSifaId(sesionId, f.codigo),
        sesionId,
        codigo: f.codigo,
        existencia: f.existencia,
        nombreReporte: f.nombre || undefined,
        archivo,
        fechaCarga,
      });
      guardados++;
    }
  });

  return { guardados, ignorados, sinExistencia };
}

/**
 * Vista de reconciliación a nivel de código: Stock SIFA vs Stock físico
 * (triangulado). Solo para dispositivos privilegiados (usa el stock físico, que
 * un contador no puede ver — blind count).
 */
export function reconciliacionDeSesion(
  sesionId: string,
  viewer: Viewer,
): FilaReconciliacion[] {
  if (!esPrivilegiado(viewer)) return [];
  const filas = consolidadoDeSesion(sesionId, viewer, { soloConMovimiento: false });
  return construirReconciliacion(
    filas,
    repo.stockSifaDeSesion(sesionId),
  ).filter((f) => f.stockSifa !== null || f.lotesResueltos > 0);
}

export function exportarReconciliacionCsv(filas: FilaReconciliacion[]): string {
  const head = [
    'codigo',
    'nombre',
    'stock_sifa',
    'stock_fisico',
    'diferencia',
    'estado',
    'lotes_resueltos',
    'lotes_totales',
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = filas.map((f) =>
    [
      f.codigo,
      f.nombre,
      f.stockSifa ?? '',
      f.stockFisico ?? '',
      f.diferencia ?? '',
      f.estado,
      f.lotesResueltos,
      f.lotesTotales,
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lineas].join('\n');
}

/**
 * Elimina una sesión y todo lo que cuelga de ella (conteos, miembros, alertas).
 * Se ejecuta desde el dispositivo del Admin en un solo bloque; el sink propaga
 * los borrados a Firestore. (Las ubicaciones son globales, no se tocan.)
 */
export function eliminarSesion(sesionId: string) {
  enLote(() => {
    for (const c of repo.conteosDeSesion(sesionId)) {
      repo.eliminarDoc('conteos', c.id);
    }
    for (const m of repo.miembrosDeSesion(sesionId)) {
      repo.eliminarDoc('miembros', m.id);
    }
    for (const a of repo.alertasDeSesion(sesionId)) {
      repo.eliminarDoc('alertas', a.id);
    }
    for (const s of repo.stockSifaDeSesion(sesionId)) {
      repo.eliminarDoc('stockSifa', s.id);
    }
    repo.eliminarDoc('sesiones', sesionId);
  });
}

// ───────────────────────── Lecturas con blind count ─────────────────────────

/**
 * Conteos visibles para el viewer (spec 2.3): un contador solo ve los de su
 * propio rol; ADMIN y AUDITOR ven todos. Réplica en la app de la RLS que
 * después reforzará Firestore.
 */
export function conteosVisibles(sesionId: string, viewer: Viewer): Conteo[] {
  const todos = repo.conteosDeSesion(sesionId);
  if (esPrivilegiado(viewer)) return todos;
  return todos.filter((c) => c.rolConteo === viewer.rolConteo);
}

/** IDs de los conteos vigentes de la sesión (la vigencia se deriva en lectura). */
export function idsVigentes(sesionId: string): Set<string> {
  return new Set(
    seleccionarVigentes(repo.conteosDeSesion(sesionId)).map((c) => c.id),
  );
}

export interface ProgresoSesion {
  totalLotesConQr: number;
  conteo1: number;
  conteo2: number;
  muestreo: number;
  coinciden: number;
  discrepancias: number;
  auditados: number;
}

export function progresoSesion(sesionId: string): ProgresoSesion {
  const lotes = lotesDeSesion(sesionId).filter((l) => l.requiereQr);
  const vigentesPorLote = new Map<string, Conteo[]>();
  for (const c of seleccionarVigentes(repo.conteosDeSesion(sesionId))) {
    const arr = vigentesPorLote.get(c.loteId) ?? [];
    arr.push(c);
    vigentesPorLote.set(c.loteId, arr);
  }
  let conteo1 = 0,
    conteo2 = 0,
    muestreo = 0,
    coinciden = 0,
    discrepancias = 0,
    auditados = 0;
  for (const lote of lotes) {
    const vig = vigentesPorLote.get(lote.id) ?? [];
    const cant = cantidadesDeLote(vig);
    if (cant.p1 !== null) conteo1++;
    if (cant.p2 !== null) conteo2++;
    if (cant.p3 !== null) muestreo++;
    switch (estadoTriangulacion(cant)) {
      case 'COINCIDE':
        coinciden++;
        break;
      case 'DISCREPANCIA':
        discrepancias++;
        break;
      case 'AUDITADO':
        auditados++;
        break;
    }
  }
  return {
    totalLotesConQr: lotes.length,
    conteo1,
    conteo2,
    muestreo,
    coinciden,
    discrepancias,
    auditados,
  };
}

// ───────────────────────── Consolidado ─────────────────────────

/**
 * Vista consolidada de la sesión (spec 2.4 + regla de stock 3). Para un viewer
 * no privilegiado se ocultan las columnas de los otros roles (blind count).
 */
export function consolidadoDeSesion(
  sesionId: string,
  viewer: Viewer,
  opts: { soloConMovimiento?: boolean } = {},
): FilaConsolidado[] {
  const priv = esPrivilegiado(viewer);
  const conteos = seleccionarVigentes(conteosVisibles(sesionId, viewer));
  const grupos = agruparConteos(conteos);

  const lotes = lotesDeSesion(sesionId, { incluirContados: true });
  const entradas = lotes.map((lote) => {
    const vigentes: Conteo[] = [];
    for (const rol of ['CONTEO_1', 'CONTEO_2', 'MUESTREO'] as RolConteo[]) {
      const g = grupos.get(
        claveGrupo({ sesionId, loteId: lote.id, rolConteo: rol }),
      );
      if (g && g[0]) vigentes.push(g[0]);
    }
    return {
      lote,
      producto: repo.producto(lote.codigoProducto),
      conteosVigentes: vigentes,
    };
  });

  let filas = construirConsolidado(entradas);

  if (!priv) {
    // Un contador solo puede ver su propia columna.
    filas = filas.map((f) => ({
      ...f,
      cantidadP1: viewer.rolConteo === 'CONTEO_1' ? f.cantidadP1 : null,
      cantidadP2: viewer.rolConteo === 'CONTEO_2' ? f.cantidadP2 : null,
      cantidadP3: viewer.rolConteo === 'MUESTREO' ? f.cantidadP3 : null,
      estadoTriangulacion: 'PENDIENTE',
      stockOficial: null,
      estadoStock: 'PENDIENTE',
    }));
  }

  if (opts.soloConMovimiento) {
    filas = filas.filter(
      (f) =>
        f.cantidadP1 !== null ||
        f.cantidadP2 !== null ||
        f.cantidadP3 !== null,
    );
  }
  return filas;
}

export function exportarConsolidadoCsv(filas: FilaConsolidado[]): string {
  const head = [
    'codigo',
    'nombre',
    'lote',
    'vencimiento',
    'conteo_1',
    'conteo_2',
    'muestreo',
    'estado_triangulacion',
    'stock_fisico',
    'estado_stock',
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = filas.map((f) =>
    [
      f.codigo,
      f.nombre,
      f.lote,
      f.fechaVencimiento ?? '',
      f.cantidadP1 ?? '',
      f.cantidadP2 ?? '',
      f.cantidadP3 ?? '',
      f.estadoTriangulacion,
      f.stockOficial ?? '',
      f.estadoStock,
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lineas].join('\n');
}
