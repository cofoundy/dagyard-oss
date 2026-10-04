// Siembra las dos demos (#74): «Booking marketplace» (en) y «Marketplace de reservas» (es). Idempotente: PUT reemplaza el grafo entero.
// La corre el dueño: solo su PUT recrea los bloqueantes desde cero; el de un agente conserva los que ya están.
// Uso: node scripts/seed.mjs <url>   (el token sale de ~/.config/dagyard/owner-token, nunca de argv)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEMO_PROJECT_IDS, demoLang, demoProject } from '@dagyard/model';

const base = (process.argv[2] ?? process.env.DAGYARD_URL ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Uso: node scripts/seed.mjs <url>   p. ej. https://dagyard.<cuenta>.workers.dev');
  process.exit(2);
}
const keyPath = join(homedir(), '.config', 'dagyard', 'owner-token');
let key;
try {
  key = readFileSync(keyPath, 'utf8').trim();
} catch {
  console.error(`No encuentro el token del dueño en ${keyPath}`);
  process.exit(2);
}

for (const id of DEMO_PROJECT_IDS) {
  const res = await fetch(`${base}/api/projects/${id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(demoProject(demoLang(id))),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PUT ${id} ${res.status}: ${text}`);
    process.exit(1);
  }
  const snap = JSON.parse(text);
  const open = snap.blockers.filter((b) => b.status === 'open').length;
  console.log(`${id}: «${snap.project.name}», ${snap.nodes.length} tareas, ${snap.project.stages.length} etapas, ${open} bloqueantes abiertos (seq ${snap.seq})`);
}
