import { useState } from 'react';
import { toast } from './toast';
import {
  conteosPendientes,
  estaSincronizando,
  estadoConexion,
  setSimularOffline,
  sincronizarTodo,
} from '../data/sync';
import { useSync } from '../data/useSync';

const LABEL = {
  online: 'En línea',
  offline: 'Sin conexión',
  local: 'Solo local',
} as const;

const BADGE = {
  online: 'ok',
  offline: 'warn',
  local: 'muted',
} as const;

export function SyncStatus() {
  useSync();
  const [offline, setOffline] = useState(false);
  const estado = estadoConexion();
  const pendientes = conteosPendientes().length;

  return (
    <div style={{ padding: '.5rem 0' }}>
      <div className="nav-section" style={{ margin: '0 0 .35rem' }}>
        Sincronización
      </div>
      <div className="row" style={{ gap: '.4rem', marginBottom: '.4rem' }}>
        <span className={'badge ' + BADGE[estado]}>{LABEL[estado]}</span>
        {pendientes > 0 && (
          <span className="badge warn">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="row" style={{ gap: '.4rem' }}>
        <button
          className="sm"
          disabled={estado === 'local' || estado === 'offline' || estaSincronizando()}
          onClick={async () => {
            const nada = pendientes === 0;
            await sincronizarTodo();
            toast(nada ? 'Nada pendiente' : 'Sincronizado');
          }}
        >
          {estaSincronizando() ? 'Sincronizando…' : 'Sincronizar'}
        </button>
        <label className="row" style={{ gap: '.3rem', fontSize: '.78rem' }}>
          <input
            type="checkbox"
            checked={offline}
            onChange={(e) => {
              setOffline(e.target.checked);
              setSimularOffline(e.target.checked);
            }}
          />
          simular offline
        </label>
      </div>
    </div>
  );
}
