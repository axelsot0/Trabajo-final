import type { Env } from '../env.ts';
import { methodNotAllowed, notFound } from './response.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  params: Record<string, string>;
}

export type Handler = (rc: RequestContext) => Promise<Response> | Response;

interface Route {
  method: HttpMethod;
  pattern: URLPattern;
  handler: Handler;
}

/**
 * Router mínimo basado en `URLPattern` (disponible en Workers). Se evita un
 * framework para mantener el control de cabeceras, tamaño de cuerpo y errores.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pathname: string, handler: Handler): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname }), handler });
    return this;
  }

  get(pathname: string, handler: Handler): this {
    return this.add('GET', pathname, handler);
  }

  post(pathname: string, handler: Handler): this {
    return this.add('POST', pathname, handler);
  }

  async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let pathMatched = false;

    for (const route of this.routes) {
      const match = route.pattern.exec(url);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;

      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(match.pathname.groups)) {
        params[key] = decodeURIComponent(value);
      }
      return route.handler({ request, env, ctx, url, params });
    }

    return pathMatched ? methodNotAllowed() : notFound();
  }
}
