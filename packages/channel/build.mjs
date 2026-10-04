// Un solo `dist/dagyard-channel.mjs`: el SDK de MCP va dentro del bundle; WebSocket y fetch son los de Node.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const outfile = 'dist/dagyard-channel.mjs';
await build({
  entryPoints: ['src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    // algunas dependencias CJS del SDK llaman a require(); en ESM hay que dárselo
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(outfile, 0o755);
