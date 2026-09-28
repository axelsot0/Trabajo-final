import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Cada archivo de prueba arranca con el esquema completo aplicado sobre una D1
// aislada (isolatedStorage), así las pruebas no dependen del orden de ejecución.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
