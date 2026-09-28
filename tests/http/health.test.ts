import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports.default;

describe('GET /health', () => {
  it('responde ok con la configuración validada y D1 accesible', async () => {
    const res = await worker.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    await expect(res.json()).resolves.toEqual({
      status: 'ok',
      env: 'development',
      aiMode: 'off',
    });
  });

  it('devuelve 404 en rutas desconocidas y 405 en métodos no permitidos', async () => {
    const notFound = await worker.fetch('https://example.com/no-existe');
    expect(notFound.status).toBe(404);

    const wrongMethod = await worker.fetch('https://example.com/health', { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
  });
});

describe('GET /app', () => {
  it('nunca sirve el dashboard sin sesión', async () => {
    const res = await worker.fetch('https://example.com/app');
    expect(res.status).toBe(401);
    const nested = await worker.fetch('https://example.com/app/index.html');
    expect(nested.status).toBe(401);
  });
});
