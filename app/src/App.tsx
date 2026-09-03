import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ToastHost } from './components/toast';
import { UserSwitcher } from './components/UserSwitcher';
import { SyncStatus } from './components/SyncStatus';
import { esSuperAdmin, useSesion } from './auth/firebaseAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SessionsPage } from './features/conteo/SessionsPage';
import { SessionPage } from './features/conteo/SessionPage';
import { CountPage } from './features/conteo/CountPage';
import { ConsolidatedPage } from './features/conteo/ConsolidatedPage';
import { UsersPage } from './features/admin/UsersPage';

// Páginas con dependencias pesadas (pdfjs, pdf-lib, qrcode) → carga diferida.
const ImportPage = lazy(() =>
  import('./features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const PreviewPage = lazy(() =>
  import('./features/import/PreviewPage').then((m) => ({ default: m.PreviewPage })),
);
const CatalogPage = lazy(() =>
  import('./features/labels/CatalogPage').then((m) => ({ default: m.CatalogPage })),
);
const GeneratePage = lazy(() =>
  import('./features/labels/GeneratePage').then((m) => ({ default: m.GeneratePage })),
);
const ReprintPage = lazy(() =>
  import('./features/labels/ReprintPage').then((m) => ({ default: m.ReprintPage })),
);

function Sidebar({ superAdmin }: { superAdmin: boolean }) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <img src="/logo.png" alt="" />
        <span>
          QR Inventarios
          <br />
          <span className="muted" style={{ fontWeight: 400, fontSize: '.75rem' }}>
            by NelSystems
          </span>
        </span>
      </div>

      <div className="nav-section">Conteo</div>
      <NavLink to="/sesiones" className="nav-link">
        Sesiones de inventario
      </NavLink>

      <div className="nav-section">Etiquetado</div>
      <NavLink to="/importar" className="nav-link">
        Importar PDF
      </NavLink>
      <NavLink to="/catalogo" className="nav-link">
        Catálogo y exclusiones
      </NavLink>
      <NavLink to="/generar" className="nav-link">
        Generar etiquetas
      </NavLink>
      <NavLink to="/reimprimir" className="nav-link">
        Reimprimir
      </NavLink>

      {superAdmin && (
        <>
          <div className="nav-section">Administración</div>
          <NavLink to="/usuarios" className="nav-link">
            Usuarios
          </NavLink>
        </>
      )}

      <div style={{ marginTop: 'auto' }}>
        <SyncStatus />
        <UserSwitcher />
      </div>
    </nav>
  );
}

export default function App() {
  const sesion = useSesion();

  if (sesion.estado === 'cargando') {
    return <p className="muted" style={{ padding: '2rem' }}>Cargando…</p>;
  }
  if (sesion.estado === 'anon') {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }

  const superAdmin = esSuperAdmin(sesion.uid);

  return (
    <div className="app">
      <Sidebar superAdmin={superAdmin} />
      <main className="content">
        {sesion.errorSync && (
          <p className="badge warn" style={{ display: 'block', marginBottom: '1rem' }}>
            Sin sincronización con Firestore: {sesion.errorSync}. La app funciona
            localmente y sincronizará al reconectar.
          </p>
        )}
        <Suspense fallback={<p className="muted">Cargando…</p>}>
          <Routes>
            <Route path="/" element={<Navigate to="/sesiones" replace />} />
            <Route path="/sesiones" element={<SessionsPage />} />
            <Route path="/sesiones/:id" element={<SessionPage />} />
            <Route path="/sesiones/:id/contar" element={<CountPage />} />
            <Route path="/sesiones/:id/consolidado" element={<ConsolidatedPage />} />
            <Route path="/importar" element={<ImportPage />} />
            <Route path="/importar/:id" element={<PreviewPage />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/generar" element={<GeneratePage />} />
            <Route path="/reimprimir" element={<ReprintPage />} />
            {superAdmin && <Route path="/usuarios" element={<UsersPage />} />}
          </Routes>
        </Suspense>
      </main>
      <ToastHost />
    </div>
  );
}
