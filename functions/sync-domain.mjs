// Copia las reglas de negocio puras de la app a functions/ para que la Cloud
// Function use EXACTAMENTE la misma lógica. Se ejecuta en el predeploy.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'app', 'src', 'domain');
const to = join(here, 'src', 'domain');
mkdirSync(to, { recursive: true });

for (const f of ['types.ts', 'triangulacion.ts', 'sincronizacion.ts', 'alertas.ts']) {
  copyFileSync(join(from, f), join(to, f));
  console.log('sync-domain:', f);
}
