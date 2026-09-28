import { constantTimeEqualString } from '../../adapters/meta/signature.ts';
import { telegramUpdateSchema, toMinimalUpdate } from '../../adapters/telegram/update-schema.ts';
import { requireSecret } from '../../config.ts';
import { createContainer } from '../../container.ts';
import { newId } from '../../domain/ids.ts';
import { toIsoUtc } from '../../domain/time.ts';
import { readBodyWithLimit } from '../body.ts';
import { error, text } from '../response.ts';
import type { Handler } from '../router.ts';

export const TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/**
 * Webhook de la Bot API. Autentica con el encabezado secreto fijado en `setWebhook`,
 * persiste el update con clave idempotente y lo procesa antes de responder: las
 * respuestas al agente viajan por la API, no por esta respuesta HTTP.
 */
export const telegramWebhookHandler: Handler = async ({ request, env }) => {
  const secret = requireSecret(env, 'TELEGRAM_WEBHOOK_SECRET');
  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqualString(provided, secret)) {
    return error(401, 'invalid_secret', 'Secreto de webhook inválido');
  }

  const body = await readBodyWithLimit(request, TELEGRAM_WEBHOOK_MAX_BODY_BYTES);
  if (!body.ok) return error(413, 'payload_too_large', 'Cuerpo demasiado grande');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return error(400, 'invalid_json', 'Cuerpo no es JSON válido');
  }
  const parsed = telegramUpdateSchema.safeParse(json);
  if (!parsed.success) return error(400, 'invalid_update', 'Update no reconocido');

  const container = createContainer(env);
  const nowUtc = toIsoUtc(container.clock.now());
  const inserted = await container.repos.webhookEvents.insertIfNew({
    id: newId(),
    provider: 'telegram',
    externalEventKey: `telegram:${parsed.data.update_id}`,
    receivedAtUtc: nowUtc,
    processStatus: 'pending',
    attempts: 0,
    errorCode: null,
    payloadMinimal: JSON.stringify(toMinimalUpdate(parsed.data)),
    processedAtUtc: null,
  });
  if (inserted) await container.processPendingWebhookEvents.run();
  return text('OK');
};
