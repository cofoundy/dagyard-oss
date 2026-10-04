// Un solo `dist/dagyard.mjs`, sin dependencias en runtime (fetch y node:* nativos).
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const outfile = 'dist/dagyard.mjs';
await build({
  entryPoints: ['src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(outfile, 0o755);
