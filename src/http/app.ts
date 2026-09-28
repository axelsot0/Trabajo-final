import { MissingSecretError } from '../config.ts';
import type { Env } from '../env.ts';
import { error } from './response.ts';
import { Router } from './router.ts';
import { dashboardHandler } from './routes/dashboard.ts';
import { healthHandler } from './routes/health.ts';

export function buildRouter(): Router {
  return new Router()
    .get('/health', healthHandler)
    .get('/app', dashboardHandler)
    .get('/app/*', dashboardHandler);
}

const router = buildRouter();

export async function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    return await router.handle(request, env, ctx);
  } catch (err) {
    if (err instanceof MissingSecretError) {
      // El nombre del secreto ausente es útil para el operador y no revela su valor.
      console.error('config_error', { secret: err.secretName });
      return error(503, 'not_configured', 'Servicio no configurado');
    }
    console.error('unhandled_error', {
      name: err instanceof Error ? err.name : 'unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return error(500, 'internal_error', 'Error interno');
  }
}
