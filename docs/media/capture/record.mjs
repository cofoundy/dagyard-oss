// Re-records the README media from the deployed demo. Usage (from the repo root):
//   node docs/media/capture/record.mjs [sky|decision|tab|hero|realtime|all]
// Writes docs/media/{sky.jpg, decision.jpg, tab-notice.png, hero.webp, realtime.webp}. The takes that answer or
// open a blocker re-seed the demo first and again at the end (apps/worker/scripts/seed.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA, OUT, ROOT, URL, calm, open, recorder, sky, star } from './lib.mjs';

const seed = () => execFileSync('node', [join(ROOT, 'apps/worker/scripts/seed.mjs'), URL], { stdio: 'inherit' });
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const glide = (page, x, y) => page.mouse.move(x, y, { steps: 30 });

/** ffconcat list → animated WebP (GitHub renders it inline; a GIF of this sky weighs 4× more and bands). */
function webp(list, out, vf = '', quality = 80) {
  const mp4 = list.replace(/list\.txt$/, 'src.mp4');
  ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', mp4);
  ffmpeg('-i', mp4, '-vf', `${vf}fps=15,scale=1040:-1:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', String(quality), '-compression_level', '4', '-loop', '0', '-an', out);
}

const jpg = (png, out) => ffmpeg('-i', png, '-vf', 'scale=1920:-1:flags=lanczos', '-q:v', '3', out);

const takes = {
  /** The overview and the tab title + favicon, read from the live page. */
  async sky() {
    const s = await open({ scale: 2 });
    await sky(s.page);
    if (!(await calm(s.page))) throw new Error('sky: the toasts never cleared');
    await s.page.screenshot({ path: join(OUT, 'sky.png') });
    const tab = await s.page.evaluate(() => ({ title: document.title, icon: document.querySelector('link[rel~="icon"]')?.href }));
    writeFileSync(join(OUT, 'tab.json'), JSON.stringify(tab));
    await s.close();
    jpg(join(OUT, 'sky.png'), join(MEDIA, 'sky.jpg'));
  },

  /** The card of «Commission model» with its open decision, the pointer on the first option. */
  async decision() {
    const s = await open({ scale: 2 });
    await sky(s.page);
    const [x, y] = await star(s.page, 'Commission model');
    await s.page.mouse.click(x, y);
    await s.page.waitForTimeout(3000);
    const b = await s.page.locator('aside.card .opts button').first().boundingBox();
    await s.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await s.page.waitForTimeout(600);
    if (!(await calm(s.page))) throw new Error('decision: the toasts never cleared');
    await s.page.screenshot({ path: join(OUT, 'decision.png') });
    await s.close();
    jpg(join(OUT, 'decision.png'), join(MEDIA, 'decision.jpg'));
  },

  /** The browser tab: title and favicon are the real ones (tab.json, from `sky`); the tab strip is drawn. */
  async tab() {
    const tab = JSON.parse(readFileSync(join(OUT, 'tab.json'), 'utf8'));
    const shot = readFileSync(join(OUT, 'sky.png')).toString('base64');
    const html = readFileSync(join(import.meta.dirname, 'tab.html'), 'utf8')
      .replace('{{ICON}}', tab.icon)
      .replace('{{TITLE}}', tab.title)
      .replace('{{SHOT}}', shot);
    const s = await open({ width: 1200, height: 500, scale: 2 });
    await s.page.setContent(html);
    await s.page.locator('.win').screenshot({ path: join(MEDIA, 'tab-notice.png'), omitBackground: true });
    await s.close();
  },

  /** The hero: the sky alive → fly into «Commission model» → answer the decision → back to the overview. */
  async hero() {
    seed();
    const s = await open();
    const { page } = s;
    await sky(page);
    await page.mouse.move(900, 300);
    const rec = await recorder(page, 'hero');
    await rec.start();
    await page.waitForTimeout(3500);
    const [x, y] = await star(page, 'Commission model');
    await glide(page, x, y);
    await page.waitForTimeout(500);
    await page.mouse.click(x, y);
    await page.waitForTimeout(2600);
    const opt = page.locator('aside.card .opts button').first();
    const ob = await opt.boundingBox();
    await glide(page, ob.x + ob.width / 2, ob.y + ob.height / 2);
    await page.waitForTimeout(700);
    await opt.click();
    await page.waitForTimeout(2600);
    const ov = page.getByRole('button', { name: /overview/i });
    const vb = await ov.boundingBox();
    await glide(page, vb.x + vb.width / 2, vb.y + vb.height / 2);
    await page.waitForTimeout(300);
    await ov.click();
    await page.waitForTimeout(3500);
    const list = await rec.stop();
    await s.close();
    seed();
    webp(list, join(MEDIA, 'hero.webp'), 'trim=start=2,setpts=(PTS-STARTPTS)/1.3,', 88); // 88: lower shows blocks while the camera flies
  },

  /** Real time: a REAL `dagyard block` (as an agent would run it) and the sky reacting. The terminal window is
   *  an overlay drawn on the page; the command and its output are the real ones. */
  async realtime() {
    seed();
    const ARGS = ['block', 'velocidad', '--kind', 'decision', '--q', 'Lazy-load the gallery? Saves 1.2 s on mobile.', '--opt', 'Yes, lazy-load it', '--opt', 'No, keep it as is'];
    const SHOWN = 'dagyard block velocidad --kind decision \\\n    --q "Lazy-load the gallery? Saves 1.2 s on mobile." \\\n    --opt "Yes, lazy-load it" --opt "No, keep it as is"';
    const s = await open();
    const { page } = s;
    await sky(page);
    await page.evaluate((html) => {
      const w = document.createElement('div');
      w.innerHTML = html;
      document.body.appendChild(w.firstElementChild);
    }, readFileSync(join(import.meta.dirname, 'terminal.html'), 'utf8'));
    const put = (h) => page.evaluate((x) => { document.getElementById('tx').innerHTML = x; }, h);
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const PROMPT = '<span style="color:#7fdcea">❯</span> ';
    const CURSOR = '<span style="background:#d6d6d6">&nbsp;</span>';
    const rec = await recorder(page, 'realtime');
    await rec.start();
    await put(PROMPT + CURSOR);
    await page.waitForTimeout(1500);
    for (let i = 1; i <= SHOWN.length; i += 3) {
      await put(PROMPT + esc(SHOWN.slice(0, i)) + CURSOR);
      await page.waitForTimeout(28);
    }
    await put(PROMPT + esc(SHOWN));
    await page.waitForTimeout(500);
    const out = execFileSync('node', [join(ROOT, 'packages/cli/dist/dagyard.mjs'), '--project', 'booking-marketplace', '--url', URL, ...ARGS], {
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    }).toString().trim();
    await put(`${PROMPT}${esc(SHOWN)}\n<span style="color:#9a9a9a">${esc(out)}</span>\n${PROMPT}`);
    await page.waitForTimeout(5500);
    const list = await rec.stop();
    await s.close();
    seed();
    webp(list, join(MEDIA, 'realtime.webp'));
  },
};

const what = process.argv[2] ?? 'all';
const order = what === 'all' ? ['sky', 'decision', 'tab', 'hero', 'realtime'] : [what];
for (const t of order) {
  if (!takes[t]) throw new Error(`unknown take: ${t}`);
  console.log(`· ${t}`);
  await takes[t]();
}
