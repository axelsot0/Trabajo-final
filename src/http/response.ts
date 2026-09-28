/** Respuestas HTTP uniformes. Nunca incluir PII ni secretos en los cuerpos de error. */

const securityHeaders: Record<string, string> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

export function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...securityHeaders,
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function text(body: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...securityHeaders,
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export interface ApiError {
  error: { code: string; message: string };
}

export function error(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return json(body, status);
}

export const notFound = (): Response => error(404, 'not_found', 'Recurso no encontrado');
export const methodNotAllowed = (): Response =>
  error(405, 'method_not_allowed', 'Método no permitido');
export const unauthorized = (): Response => error(401, 'unauthorized', 'Autenticación requerida');
