import {
  eventKey,
  normalizeMetaPayload,
  type MetaInboundEvent,
  type MetaWebhookPayload,
} from '../adapters/meta/webhook-schema.ts';
import { newId } from '../domain/ids.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type { WebhookEventRepository } from '../ports/repositories.ts';

export interface IngestResult {
  stored: number;
  duplicates: number;
  ignored: number;
}

/**
 * Mensajes y postbacks se procesan; los ecos también, porque confirman envíos propios y
 * registran respuestas hechas desde la app de Instagram. Lecturas y reacciones se
 * conservan como `ignored` con su tipo.
 */
function isProcessable(event: MetaInboundEvent): boolean {
  return event.kind === 'message' || event.kind === 'postback' || event.kind === 'echo';
}

/**
 * Persiste cada evento del webhook con su clave idempotente. No procesa nada: el
 * webhook debe responder rápido y el procesamiento ocurre después (ADR 0006).
 */
export class IngestMetaWebhook {
  constructor(
    private readonly webhookEvents: WebhookEventRepository,
    private readonly clock: Clock,
  ) {}

  async execute(payload: MetaWebhookPayload): Promise<IngestResult> {
    const receivedAtUtc = toIsoUtc(this.clock.now());
    const result: IngestResult = { stored: 0, duplicates: 0, ignored: 0 };

    for (const event of normalizeMetaPayload(payload)) {
      const processable = isProcessable(event);
      const inserted = await this.webhookEvents.insertIfNew({
        id: newId(),
        provider: 'meta',
        externalEventKey: eventKey(event),
        receivedAtUtc,
        processStatus: processable ? 'pending' : 'ignored',
        attempts: 0,
        errorCode: processable ? null : event.kind,
        payloadMinimal: JSON.stringify(event),
        processedAtUtc: processable ? null : receivedAtUtc,
      });
      if (!inserted) result.duplicates += 1;
      else if (processable) result.stored += 1;
      else result.ignored += 1;
    }
    return result;
  }
}
