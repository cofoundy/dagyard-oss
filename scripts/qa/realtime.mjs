#!/usr/bin/env node
// Prueba de tiempo real (docs/spec/v0.md §Gates): abre la UI en un navegador real, corre `dagyard msg` y
// `dagyard done` con el CLI y mide cuánto tarda cada comando en aparecer en el DOM. Meta: ≤3000 ms.
//
// Uso: node scripts/qa/realtime.mjs [--url <worker>] [--ui <origen de la UI>] [--runs 5] [--keep]
//   --url   API y UI desplegadas (default: ~/.config/dagyard/url o la preview de .claude/rules/entornos.md)
//   --ui    otro origen para la UI (p. ej. `vite` local con DAGYARD_API apuntando al worker)
//   --keep  no borra el proyecto de QA al terminar
//
// Las credenciales salen de ~/.config/dagyard/{owner-token,agent-key}; nunca viajan por argv: al CLI le
// llegan por env y al navegador por stdin de `agent-browser batch`.
// Mide en un proyecto propio (`qa-tiempo-real`), así la demo de André no se toca.
// Requiere `agent-browser` en el PATH y el CLI compilado (`pnpm --filter @dagyard/cli build`).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'dagyard.mjs');
const CONFIG = process.env.DAGYARD_CONFIG_DIR || join(homedir(), '.config', 'dagyard');
const PREVIEW = 'https://dagyard.cofoundy-dev.workers.dev';
const PROJECT = 'qa-tiempo-real';
const SESSION = 'dagyard-qa-realtime';
const LIMIT_MS = 3000;
const WAIT_MS = 15000;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const read = (name) => {
  try {
    return readFileSync(join(CONFIG, name), 'utf8').trim() || null;
  } catch {
    return null;
  }
};
const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

const api = (flag('url') ?? process.env.DAGYARD_URL ?? read('url') ?? PREVIEW).replace(/\/+$/, '');
const ui = (flag('ui') ?? api).replace(/\/+$/, '');
const runs = Number(flag('runs') ?? 5);
const keep = argv.includes('--keep');
const ownerToken = read('owner-token');
const agentKey = read('agent-key');
if (!ownerToken || !agentKey) fail(`Faltan owner-token o agent-key en ${CONFIG}`);
if (!existsSync(CLI)) fail(`No encuentro el CLI en ${CLI}: corre \`pnpm --filter @dagyard/cli build\``);
if (!Number.isInteger(runs) || runs < 1) fail('--runs tiene que ser un entero ≥1');

/* ------------------------------------------------------------------ API */

async function call(method, path, body, token = agentKey) {
  const res = await fetch(`${api}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// Un grafo chico: una tarea por corrida, todas en «Construcción», más una ya lista para que la escena tenga forma.
function qaGraph(n) {
  const nodes = [{ id: 'base', stage: 'diseno', title: 'Base acordada', status: 'done' }];
  for (let i = 1; i <= n; i++) {
    nodes.push({ id: `tarea-${i}`, stage: 'construccion', title: `Tarea de prueba ${i}`, status: 'working', team: 'QA', deps: ['base'] });
  }
  return { name: 'QA · tiempo real', nodes };
}

/* ------------------------------------------------------------------ navegador */

function browser(...args) {
  return execFileSync('agent-browser', ['--session', SESSION, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// Comandos con secretos: por stdin, nunca por argv.
function browserBatch(commands) {
  const r = spawnSync('agent-browser', ['--session', SESSION, 'batch', '--bail'], { input: JSON.stringify(commands), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`agent-browser batch → ${r.status}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function evalJs(js) {
  const out = browser('eval', js);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

// Observador en la página: cada vigía guarda el Date.now() del primer instante en que el DOM cumple su condición.
const OBSERVER = `(() => {
  if (window.__qa) return 'ya';
  const qa = (window.__qa = { watch: {}, seen: {} });
  const check = () => {
    for (const [key, w] of Object.entries(qa.watch)) {
      if (qa.seen[key]) continue;
      const ok =
        w.kind === 'text'
          ? [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes(w.text))
          : [...document.querySelectorAll('.sky-lbl')].some((el) => el.textContent === w.title && el.classList.contains('done'));
      if (ok) qa.seen[key] = Date.now();
    }
  };
  new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  qa.check = check;
  return 'ok';
})()`;

const watch = (key, w) => evalJs(`(window.__qa.watch[${JSON.stringify(key)}] = ${JSON.stringify(w)}, window.__qa.check(), 'ok')`);
const seen = (key) => evalJs(`window.__qa.seen[${JSON.stringify(key)}] ?? null`);

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`No apareció a tiempo: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* ------------------------------------------------------------------ CLI */

function dagyard(...args) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args, '--project', PROJECT], {
    env: { ...process.env, DAGYARD_URL: api, DAGYARD_KEY: agentKey },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`dagyard ${args[0]} → ${r.status}: ${r.stderr}`);
  return t0;
}

/* ------------------------------------------------------------------ corrida */

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  console.log(`API ${api} · UI ${ui} · ${runs} corridas · meta ≤${LIMIT_MS} ms`);
  await call('PUT', `/projects/${PROJECT}`, qaGraph(runs));

  browser('open', ui);
  browserBatch([
    ['eval', `fetch('/api/session', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: ${JSON.stringify(ownerToken)}})}).then((r) => r.status)`],
    ['eval', `localStorage.setItem('dagyard:project', '${PROJECT}')`],
  ]);
  browser('reload');
  await until(() => evalJs(`[...document.querySelectorAll('.sky-lbl')].some((el) => el.textContent === 'Tarea de prueba 1')`) === true, WAIT_MS, 'la UI con el proyecto de QA');
  evalJs(OBSERVER);

  const rows = [];
  for (let i = 1; i <= runs; i++) {
    const node = `tarea-${i}`;
    const text = `Medición ${i} · ${Date.now().toString(36)}`;

    watch(`msg-${i}`, { kind: 'text', text });
    const tMsg = dagyard('msg', node, text);
    const msg = (await until(() => seen(`msg-${i}`), WAIT_MS, `mensaje ${i}`)) - tMsg;

    watch(`done-${i}`, { kind: 'done', title: `Tarea de prueba ${i}` });
    const tDone = dagyard('done', node);
    const done = (await until(() => seen(`done-${i}`), WAIT_MS, `tarea ${i} lista`)) - tDone;

    rows.push({ msg, done });
    console.log(`corrida ${i}: msg ${msg} ms · done ${done} ms`);
  }

  const all = rows.flatMap((r) => [r.msg, r.done]);
  for (const [label, xs] of [['msg', rows.map((r) => r.msg)], ['done', rows.map((r) => r.done)], ['todo', all]]) {
    console.log(`${label.padEnd(4)} p50 ${pct(xs, 50)} ms · máx ${Math.max(...xs)} ms`);
  }
  const ok = all.every((x) => x <= LIMIT_MS);
  console.log(ok ? `OK: las ${all.length} mediciones ≤${LIMIT_MS} ms` : `FALLA: hay mediciones >${LIMIT_MS} ms`);
  return ok;
}

let ok = false;
try {
  ok = await main();
} catch (e) {
  console.error(String(e?.message ?? e));
} finally {
  try {
    browser('close');
  } catch {
    /* ya cerrado */
  }
  if (!keep) await call('DELETE', `/projects/${PROJECT}`, undefined, ownerToken).catch((e) => console.error(String(e.message)));
}
process.exit(ok ? 0 : 1);
