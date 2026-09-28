import { z } from 'zod';

import type {
  InstagramGateway,
  ListRecentMessagesInput,
  ListRecentMessagesResult,
  RemoteMessage,
  SendTextInput,
  SendTextResult,
} from '../../ports/instagram-gateway.ts';

export interface MetaInstagramGatewayOptions {
  graphVersion: string;
  /** Resuelve el nombre del secreto al token. Lanza si no está configurado. */
  resolveToken: (tokenReference: string) => string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const sendResponseSchema = z
  .object({
    recipient_id: z.string().optional(),
    message_id: z.string().min(1),
  })
  .loose();

const errorResponseSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.number().optional(),
        error_subcode: z.number().optional(),
      })
      .loose(),
  })
  .loose();

const conversationsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().optional(),
          messages: z
            .object({
              data: z.array(
                z
                  .object({
                    id: z.string(),
                    created_time: z.string().optional(),
                    from: z.object({ id: z.string().optional() }).loose().optional(),
                    message: z.string().optional(),
                  })
                  .loose(),
              ),
            })
            .loose()
            .optional(),
        })
        .loose(),
    ),
  })
  .loose();

/** Códigos de Graph API que indican límite de tasa o fallo transitorio. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);
/** Códigos que indican token inválido o expirado. */
const TOKEN_CODES = new Set([190, 102]);

function classifyError(
  httpStatus: number,
  code: number | undefined,
  subcode: number | undefined,
): { errorCode: string; retryable: boolean; tokenInvalid: boolean } {
  if (code !== undefined && TOKEN_CODES.has(code)) {
    return { errorCode: 'token_invalid', retryable: false, tokenInvalid: true };
  }
  if (httpStatus === 429 || (code !== undefined && RETRYABLE_CODES.has(code))) {
    return { errorCode: 'rate_limited', retryable: true, tokenInvalid: false };
  }
  if (httpStatus >= 500) {
    return { errorCode: 'meta_unavailable', retryable: true, tokenInvalid: false };
  }
  if (code === 10 || code === 200 || code === 230) {
    // Permiso insuficiente o fuera de ventana/política: reintentar no lo arregla.
    return { errorCode: 'outside_window_or_permission', retryable: false, tokenInvalid: false };
  }
  if (code === 551) {
    return { errorCode: 'user_unavailable', retryable: false, tokenInvalid: false };
  }
  const suffix =
    code === undefined
      ? String(httpStatus)
      : `${code}${subcode === undefined ? '' : `.${subcode}`}`;
  return { errorCode: `meta_error_${suffix}`, retryable: false, tokenInvalid: false };
}

/**
 * Adaptador de la Messaging API de Instagram (Instagram Login). El cuerpo exacto
 * y la versión se validan contra la documentación en `docs/meta-validation.md`.
 */
export class MetaInstagramGateway implements InstagramGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: MetaInstagramGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? 'https://graph.instagram.com';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const token = this.options.resolveToken(input.tokenReference);
    const url = `${this.baseUrl}/${this.options.graphVersion}/${encodeURIComponent(input.igUserId)}/messages`;
    const body: Record<string, unknown> = {
      recipient: { id: input.recipientId },
      message: { text: input.text },
    };
    if (input.humanAgentTag) {
      body['messaging_type'] = 'MESSAGE_TAG';
      body['tag'] = 'HUMAN_AGENT';
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      return { ok: false, kind: 'uncertain', errorCode: isTimeout ? 'timeout' : 'network_error' };
    }

    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = sendResponseSchema.safeParse(json);
      if (parsed.success) {
        return {
          ok: true,
          messageId: parsed.data.message_id,
          recipientId: parsed.data.recipient_id ?? null,
        };
      }
      // 2xx sin message_id: Meta probablemente envió; no reintentar a ciegas.
      return { ok: false, kind: 'uncertain', errorCode: 'unexpected_success_body' };
    }

    const parsedError = errorResponseSchema.safeParse(json);
    const code = parsedError.success ? parsedError.data.error.code : undefined;
    const subcode = parsedError.success ? parsedError.data.error.error_subcode : undefined;
    return {
      ok: false,
      kind: 'rejected',
      httpStatus: response.status,
      ...classifyError(response.status, code, subcode),
    };
  }

  async listRecentMessages(input: ListRecentMessagesInput): Promise<ListRecentMessagesResult> {
    const token = this.options.resolveToken(input.tokenReference);
    const url = new URL(
      `${this.baseUrl}/${this.options.graphVersion}/${encodeURIComponent(input.igUserId)}/conversations`,
    );
    url.searchParams.set('user_id', input.recipientId);
    url.searchParams.set('fields', 'id,messages.limit(20){id,created_time,from,message}');

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { ok: false, errorCode: 'network_error' };
    }
    if (!response.ok) return { ok: false, errorCode: `http_${response.status}` };

    const parsed = conversationsResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return { ok: false, errorCode: 'unexpected_body' };

    const messages: RemoteMessage[] = [];
    for (const conversation of parsed.data.data) {
      for (const m of conversation.messages?.data ?? []) {
        const created = m.created_time === undefined ? null : new Date(m.created_time);
        messages.push({
          mid: m.id,
          fromId: m.from?.id ?? null,
          text: m.message ?? null,
          createdTimeUtc:
            created !== null && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
        });
      }
    }
    return { ok: true, messages };
  }
}
