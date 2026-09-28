import { metaWebhookPayloadSchema } from '../../adapters/meta/webhook-schema.ts';
import { constantTimeEqualString, verifyMetaSignature } from '../../adapters/meta/signature.ts';
import { requireSecret } from '../../config.ts';
import { createContainer } from '../../container.ts';
import { readBodyWithLimit } from '../body.ts';
import { error, text } from '../response.ts';
import type { Handler } from '../router.ts';

/** Meta envía lotes pequeños; 256 KiB deja margen sin permitir cuerpos abusivos. */
export const META_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** Verificación de suscripción: `GET` con `hub.mode`, `hub.verify_token` y `hub.challenge`. */
export const metaWebhookVerifyHandler: Handler = ({ url, env }) => {
  const verifyToken = requireSecret(env, 'META_VERIFY_TOKEN');
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || token === null || challenge === null) {
    return error(400, 'bad_request', 'Parámetros de verificación incompletos');
  }
  if (!constantTimeEqualString(token, verifyToken)) {
    return error(403, 'forbidden', 'Token de verificación inválido');
  }
  return text(challenge);
};

/**
 * Recepción de eventos: firma sobre bytes crudos, persistencia idempotente y 200
 * inmediato. El procesamiento se difiere a `waitUntil` (y al Cron como respaldo).
 */
export const metaWebhookReceiveHandler: Handler = async ({ request, env, ctx }) => {
  const appSecret = requireSecret(env, 'META_APP_SECRET');

  const body = await readBodyWithLimit(request, META_WEBHOOK_MAX_BODY_BYTES);
  if (!body.ok) return error(413, 'payload_too_large', 'Cuerpo demasiado grande');

  const signatureOk = await verifyMetaSignature(
    appSecret,
    body.bytes,
    request.headers.get('x-hub-signature-256'),
  );
  if (!signatureOk) return error(401, 'invalid_signature', 'Firma inválida');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return error(400, 'invalid_json', 'Cuerpo no es JSON válido');
  }

  const parsed = metaWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    // Firmado por Meta pero con forma inesperada (otro objeto/campo). Se acepta para
    // que Meta no reintente y se deja constancia sin contenido del cliente.
    console.warn('meta_webhook_unexpected_shape', { issues: parsed.error.issues.length });
    return text('EVENT_RECEIVED');
  }

  const container = createContainer(env);
  const summary = await container.ingestMetaWebhook.execute(parsed.data);

  if (summary.stored > 0) {
    ctx.waitUntil(
      container.processPendingWebhookEvents.run().catch((err: unknown) => {
        console.error('deferred_processing_failed', {
          error: err instanceof Error ? err.name : 'unknown',
        });
      }),
    );
  }
  return text('EVENT_RECEIVED');
};
