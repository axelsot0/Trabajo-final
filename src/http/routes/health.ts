import { loadAppConfig } from '../../config.ts';
import { json } from '../response.ts';
import type { Handler } from '../router.ts';

/**
 * Comprobación de vida sin datos sensibles. Verifica que la configuración es
 * válida y que D1 responde; no expone nombres de secretos ni versiones internas.
 */
export const healthHandler: Handler = async ({ env }) => {
  const config = loadAppConfig(env);
  const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return json({
    status: row?.ok === 1 ? 'ok' : 'degraded',
    env: config.appEnv,
    aiMode: config.aiMode,
  });
};
