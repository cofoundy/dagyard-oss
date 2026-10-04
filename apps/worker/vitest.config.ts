import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // secrets de prueba: los reales viven como secrets del Worker, nunca aquí
        bindings: {
          OWNER_TOKEN: 'test-owner-token',
          AGENT_KEY: 'test-agent-key',
          VAULT_KEY: 'test-vault-key',
        },
      },
    }),
  ],
});
