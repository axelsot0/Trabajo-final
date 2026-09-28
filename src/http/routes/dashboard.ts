import { unauthorized } from '../response.ts';
import type { Handler } from '../router.ts';

interface DashboardSession {
  employeeId: string;
}

/**
 * Resuelve la sesión del panel a partir de la cookie. Hasta que exista el login
 * por enlace de un solo uso (paso 10 del plan) no hay sesiones válidas, así que
 * el invariante "nada del panel es accesible de forma anónima" se cumple desde el
 * primer despliegue.
 */
function resolveSession(_request: Request): DashboardSession | null {
  // TODO(paso 10): validar cookie contra `dashboard_sessions` (hash del token, expiración, revocación).
  return null;
}

export const dashboardHandler: Handler = ({ request, env }) => {
  const session = resolveSession(request);
  if (session === null) return unauthorized();
  return env.ASSETS.fetch(request);
};
