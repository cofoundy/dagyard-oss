// node shot.mjs <in.html> <out.png>: screenshots the .win element of a page (the drawn terminal window).
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const [, , inp, out] = process.argv;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
await p.goto('file://' + resolve(inp));
await p.locator('.win').screenshot({ path: out, omitBackground: true });
await b.close();
