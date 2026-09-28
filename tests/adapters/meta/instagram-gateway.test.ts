import { describe, expect, it } from 'vitest';

import { MetaInstagramGateway } from '../../../src/adapters/meta/instagram-gateway.ts';

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function gatewayWith(
  respond: (captured: Captured) => Response | Promise<Response>,
  captured: Captured[] = [],
): { gateway: MetaInstagramGateway; captured: Captured[] } {
  const gateway = new MetaInstagramGateway({
    graphVersion: 'v23.0',
    resolveToken: (ref) => `token-for-${ref}`,
    timeoutMs: 200,
    fetchImpl: (input, init) => {
      const c = {
        url:
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      };
      captured.push(c);
      return Promise.resolve(respond(c));
    },
  });
  return { gateway, captured };
}

function bodyJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('cuerpo no es string');
  return JSON.parse(init.body);
}

const input = {
  igUserId: '17841400000000000',
  tokenReference: 'META_ACCESS_TOKEN',
  recipientId: 'igsid-1',
  text: 'Hola, sí tenemos disponible.',
  humanAgentTag: false,
};

describe('MetaInstagramGateway.sendText', () => {
  it('envía al endpoint de mensajes con el cuerpo y el token esperados', async () => {
    const { gateway, captured } = gatewayWith(() =>
      Response.json({ recipient_id: 'igsid-1', message_id: 'mid.123' }),
    );
    const result = await gateway.sendText(input);
    expect(result).toEqual({ ok: true, messageId: 'mid.123', recipientId: 'igsid-1' });

    const call = captured[0];
    expect(call?.url).toBe('https://graph.instagram.com/v23.0/17841400000000000/messages');
    expect(call?.init?.method).toBe('POST');
    expect(new Headers(call?.init?.headers).get('authorization')).toBe(
      'Bearer token-for-META_ACCESS_TOKEN',
    );
    expect(bodyJson(call?.init)).toEqual({
      recipient: { id: 'igsid-1' },
      message: { text: 'Hola, sí tenemos disponible.' },
    });
  });

  it('añade la etiqueta HUMAN_AGENT solo cuando se solicita', async () => {
    const { gateway, captured } = gatewayWith(() => Response.json({ message_id: 'mid.1' }));
    await gateway.sendText({ ...input, humanAgentTag: true });
    expect(bodyJson(captured[0]?.init)).toMatchObject({
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    });
  });

  it('clasifica límite de tasa y 5xx como reintentables', async () => {
    const rate = gatewayWith(() =>
      Response.json({ error: { message: 'x', code: 4 } }, { status: 400 }),
    );
    expect(await rate.gateway.sendText(input)).toMatchObject({
      ok: false,
      kind: 'rejected',
      errorCode: 'rate_limited',
      retryable: true,
    });
    const tooMany = gatewayWith(() => new Response('', { status: 429 }));
    expect(await tooMany.gateway.sendText(input)).toMatchObject({ retryable: true });
    const down = gatewayWith(() => new Response('', { status: 503 }));
    expect(await down.gateway.sendText(input)).toMatchObject({
      errorCode: 'meta_unavailable',
      retryable: true,
    });
  });

  it('clasifica fuera de ventana/permiso y token inválido como definitivos', async () => {
    const outside = gatewayWith(() =>
      Response.json({ error: { message: 'x', code: 10, error_subcode: 2018278 } }, { status: 400 }),
    );
    expect(await outside.gateway.sendText(input)).toMatchObject({
      errorCode: 'outside_window_or_permission',
      retryable: false,
      tokenInvalid: false,
    });
    const token = gatewayWith(() =>
      Response.json({ error: { message: 'x', code: 190 } }, { status: 401 }),
    );
    expect(await token.gateway.sendText(input)).toMatchObject({
      errorCode: 'token_invalid',
      retryable: false,
      tokenInvalid: true,
    });
    const other = gatewayWith(() =>
      Response.json({ error: { message: 'x', code: 100, error_subcode: 33 } }, { status: 400 }),
    );
    expect(await other.gateway.sendText(input)).toMatchObject({
      errorCode: 'meta_error_100.33',
      retryable: false,
    });
  });

  it('un timeout o fallo de red devuelve resultado incierto, nunca rechazo', async () => {
    // El fetch inyectado espera al AbortSignal real del gateway y rechaza con su motivo.
    const timingOut = new MetaInstagramGateway({
      graphVersion: 'v23.0',
      resolveToken: () => 't',
      timeoutMs: 50,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          });
        }),
    });
    expect(await timingOut.sendText(input)).toEqual({
      ok: false,
      kind: 'uncertain',
      errorCode: 'timeout',
    });

    const network = gatewayWith(() => {
      throw new TypeError('fetch failed');
    });
    expect(await network.gateway.sendText(input)).toEqual({
      ok: false,
      kind: 'uncertain',
      errorCode: 'network_error',
    });

    const weird = gatewayWith(() => Response.json({ something: true }));
    expect(await weird.gateway.sendText(input)).toMatchObject({
      kind: 'uncertain',
      errorCode: 'unexpected_success_body',
    });
  });
});

describe('MetaInstagramGateway.listRecentMessages', () => {
  it('consulta la Conversations API filtrando por usuario y aplana los mensajes', async () => {
    const { gateway, captured } = gatewayWith(() =>
      Response.json({
        data: [
          {
            id: 'conv-1',
            messages: {
              data: [
                {
                  id: 'mid.a',
                  created_time: '2026-09-27T14:00:00+0000',
                  from: { id: '17841400000000000' },
                  message: 'Hola',
                },
                { id: 'mid.b', from: { id: 'igsid-1' } },
              ],
            },
          },
        ],
      }),
    );
    const result = await gateway.listRecentMessages({
      igUserId: '17841400000000000',
      tokenReference: 'META_ACCESS_TOKEN',
      recipientId: 'igsid-1',
    });
    const url = new URL(captured[0]?.url ?? '');
    expect(url.pathname).toBe('/v23.0/17841400000000000/conversations');
    expect(url.searchParams.get('user_id')).toBe('igsid-1');
    expect(url.searchParams.get('fields')).toContain('messages');
    expect(result).toEqual({
      ok: true,
      messages: [
        {
          mid: 'mid.a',
          fromId: '17841400000000000',
          text: 'Hola',
          createdTimeUtc: '2026-09-27T14:00:00.000Z',
        },
        { mid: 'mid.b', fromId: 'igsid-1', text: null, createdTimeUtc: null },
      ],
    });
  });

  it('devuelve error estable ante HTTP no OK o cuerpo inesperado', async () => {
    const http = gatewayWith(() => new Response('', { status: 500 }));
    expect(
      await http.gateway.listRecentMessages({
        igUserId: 'a',
        tokenReference: 'META_ACCESS_TOKEN',
        recipientId: 'b',
      }),
    ).toEqual({ ok: false, errorCode: 'http_500' });
    const body = gatewayWith(() => Response.json({ nope: 1 }));
    expect(
      await body.gateway.listRecentMessages({
        igUserId: 'a',
        tokenReference: 'META_ACCESS_TOKEN',
        recipientId: 'b',
      }),
    ).toEqual({ ok: false, errorCode: 'unexpected_body' });
  });
});
