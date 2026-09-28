import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Valores ficticios solo para pruebas; los reales viven en secretos del Worker.
            META_APP_SECRET: 'test-meta-app-secret',
            META_VERIFY_TOKEN: 'test-meta-verify-token',
          },
        },
      }),
    ],
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/setup/apply-migrations.ts'],
    },
  };
});
