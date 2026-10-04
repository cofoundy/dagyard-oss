// Shared helpers for the README captures. See README.md in this folder.
// The owner token is read from ~/.config/dagyard/owner-token, exchanged for a session inside this process
// (never printed, never in argv) and the session is closed again in close().
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const MEDIA = resolve(HERE, '..');
export const OUT = join(HERE, 'out');
export const URL = (process.env.DAGYARD_URL ?? 'https://dagyard.cofoundy-dev.workers.dev').replace(/\/+$/, '');
export const P = 'booking-marketplace';
mkdirSync(OUT, { recursive: true });

async function login() {
  const token = readFileSync(join(homedir(), '.config/dagyard/owner-token'), 'utf8').trim();
  const res = await fetch(`${URL}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.status !== 204) throw new Error(`login: ${res.status}`);
  const [pair] = res.headers.get('set-cookie').split(';');
  const i = pair.indexOf('=');
  return { name: pair.slice(0, i), value: pair.slice(i + 1) };
}

/** A headless Chrome (the one installed on the machine) signed in as the owner, on the English demo. */
export async function open({ width = 1440, height = 900, scale = 1 } = {}) {
  const cookie = await login();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: 'en-US', colorScheme: 'dark' });
  await ctx.addCookies([{ ...cookie, url: URL, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  return {
    browser,
    page,
    async close() {
      await browser.close();
      await fetch(`${URL}/api/session`, { method: 'DELETE', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    },
  };
}

/** Loads the demo and waits until the sky has settled (the first frames are «Loading the plan…»). */
export async function sky(page) {
  await page.goto(`${URL}/?p=${P}`);
  await page.waitForTimeout(12500);
  await page.mouse.move(width(page) - 10, 450);
}
const width = (page) => page.viewportSize().width;

/** Screen position of a star, from its label (the star sits just above it). */
export async function star(page, name) {
  const b = await page.getByText(name, { exact: true }).first().boundingBox();
  return [b.x + b.width / 2, b.y - 22];
}

/** Records with the CDP screencast: every frame with its real timestamp, written as an ffconcat list. */
export async function recorder(page, name) {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let on = false;
  cdp.on('Page.screencastFrame', async (f) => {
    if (on) {
      const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
    }
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  return {
    async start() {
      on = true;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    },
    async stop() {
      on = false;
      await cdp.send('Page.stopScreencast');
      const lines = ['ffconcat version 1.0'];
      frames.forEach((fr, i) => {
        const next = frames[i + 1]?.t ?? fr.t + 0.1;
        lines.push(`file '${fr.file}'`, `duration ${Math.max(0.01, next - fr.t).toFixed(3)}`);
      });
      writeFileSync(join(dir, 'list.txt'), lines.join('\n') + '\n');
      return join(dir, 'list.txt');
    },
  };
}
