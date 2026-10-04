#!/usr/bin/env node
// Prueba de tiempo real (docs/spec/v0.md §Gates): abre la UI en un navegador real, corre `dagyard msg` y
// `dagyard done` con el CLI y mide cuánto tarda cada comando en aparecer en el DOM. Meta: ≤3000 ms.
//
// Cada medición se parte en tramos (#48), todos con el reloj de esta máquina:
//   cli    comando → el CLI termina (arranque de node + HTTP + escritura + reparto, que va antes de responder)
//   ws     comando → el frame llega al WebSocket de la página (servidor + red)
//   nodo   comando → el frame llega a un WebSocket de control abierto desde node (sin navegador)
//   dom    frame en la página → el DOM lo muestra (solo navegador)
// La carga de la máquina (loadavg) se imprime al empezar y al terminar: con carga alta el número no vale.
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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
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

// Tap del WebSocket de la app: se instala antes de que cargue la página y anota cuándo llega cada evento.
const WS_TAP = `(() => {
  const Native = window.WebSocket;
  const log = (window.__qaws = []);
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (m) => {
        const t = Date.now();
        try {
          const f = JSON.parse(m.data);
          if (f.type === 'event') log.push({ t, raw: JSON.stringify(f.event) });
        } catch {}
      });
    }
  };
})();`;

// El frame que corresponde a una medición: el mensaje por su texto, la tarea por su id y su estado.
const matches = (w, raw) => {
  const e = JSON.parse(raw);
  return w.kind === 'text' ? raw.includes(w.text) : e.type === 'node.updated' && e.payload?.node?.id === w.node && e.payload.node.status === 'done';
};
const pageFrame = (w) => {
  const log = evalJs('JSON.stringify(window.__qaws ?? [])');
  const hit = (typeof log === 'string' ? JSON.parse(log) : log).find((f) => matches(w, f.raw));
  return hit?.t ?? null;
};

// Socket de control en otro proceso de node: mismo reparto, sin navegador. Va aparte porque este proceso
// se bloquea mientras corre el CLI o agent-browser, y un timestamp tomado aquí llegaría tarde.
const CONTROL = `
const ws = new WebSocket(process.env.QA_WS, ['dagyard', 'token.' + process.env.QA_TOKEN]);
ws.addEventListener('message', (m) => {
  const t = Date.now();
  const f = JSON.parse(m.data);
  if (f.type === 'hello') console.log(JSON.stringify({ hello: true }));
  if (f.type === 'event') console.log(JSON.stringify({ t, raw: JSON.stringify(f.event) }));
});
ws.addEventListener('error', () => process.exit(3));
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
`;

function controlSocket() {
  const child = spawn(process.execPath, ['--input-type=module', '-e', CONTROL], {
    env: { ...process.env, QA_WS: `${api.replace(/^http/, 'ws')}/api/projects/${PROJECT}/live`, QA_TOKEN: ownerToken },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const log = [];
  let buf = '';
  let hello;
  const ready = new Promise((ok, ko) => {
    hello = ok;
    child.on('exit', (code) => ko(new Error(`el WebSocket de control se cerró (${code})`)));
  });
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (line.hello) hello();
      else log.push(line);
    }
  });
  const close = () => {
    child.removeAllListeners('exit');
    child.stdin.end();
  };
  return { close, ready, at: (w) => log.find((f) => matches(w, f.raw))?.t ?? null };
}

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
  let exit;
  const r = spawnSync(process.execPath, [CLI, ...args, '--project', PROJECT], {
    env: { ...process.env, DAGYARD_URL: api, DAGYARD_KEY: agentKey },
    encoding: 'utf8',
  });
  exit = Date.now();
  if (r.status !== 0) throw new Error(`dagyard ${args[0]} → ${r.status}: ${r.stderr}`);
  return { t0, cli: exit - t0 };
}

/* ------------------------------------------------------------------ corrida */

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

const load = () => `loadavg ${loadavg().map((x) => x.toFixed(1)).join(' ')} en ${cpus().length} núcleos`;
const tmp = mkdtempSync(join(tmpdir(), 'dagyard-qa-'));

async function main() {
  console.log(`API ${api} · UI ${ui} · ${runs} corridas · meta ≤${LIMIT_MS} ms · ${load()}`);
  await call('PUT', `/projects/${PROJECT}`, qaGraph(runs));
  const control = controlSocket();
  await control.ready;

  const tap = join(tmp, 'ws-tap.js');
  writeFileSync(tap, WS_TAP);
  browser('--init-script', tap, 'open', ui);
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

    for (const [kind, key, w, cmd, what] of [
      ['msg', `msg-${i}`, { kind: 'text', text }, ['msg', node, text], `mensaje ${i}`],
      ['done', `done-${i}`, { kind: 'done', title: `Tarea de prueba ${i}`, node }, ['done', node], `tarea ${i} lista`],
    ]) {
      watch(key, w);
      const { t0, cli } = dagyard(...cmd);
      const dom = await until(() => seen(key), WAIT_MS, what);
      const page = pageFrame(w);
      await new Promise((r) => setImmediate(r));
      const ctl = control.at(w);
      const row = { run: i, kind, total: dom - t0, cli, ws: page && page - t0, nodo: ctl && ctl - t0, dom: page && dom - page };
      rows.push(row);
      console.log(`corrida ${i} ${kind.padEnd(4)}: total ${row.total} ms · cli ${row.cli} · ws ${row.ws} · nodo ${row.nodo} · dom ${row.dom}`);
    }
  }
  control.close();

  const all = rows.map((r) => r.total);
  for (const [label, xs] of [['msg', rows.filter((r) => r.kind === 'msg').map((r) => r.total)], ['done', rows.filter((r) => r.kind === 'done').map((r) => r.total)], ['todo', all]]) {
    console.log(`${label.padEnd(4)} p50 ${pct(xs, 50)} ms · máx ${Math.max(...xs)} ms`);
  }
  for (const part of ['cli', 'ws', 'nodo', 'dom']) {
    const xs = rows.map((r) => r[part]).filter((x) => x !== null);
    if (xs.length) console.log(`  ${part.padEnd(4)} p50 ${pct(xs, 50)} ms · máx ${Math.max(...xs)} ms`);
  }
  console.log(load());
  if (flag('json')) writeFileSync(flag('json'), JSON.stringify({ api, ui, runs, rows }, null, 2));
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
  rmSync(tmp, { recursive: true, force: true });
  if (!keep) await call('DELETE', `/projects/${PROJECT}`, undefined, ownerToken).catch((e) => console.error(String(e.message)));
}
process.exit(ok ? 0 : 1);
