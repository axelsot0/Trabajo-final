import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Inyectado por `vitest.config.ts`; solo existe en el entorno de pruebas. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
