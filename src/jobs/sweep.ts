import { createContainer, type Container } from '../container.ts';
import { MS_PER_HOUR, toIsoUtc } from '../domain/time.ts';
import type { Env } from '../env.ts';

/** Un evento en `processing` durante más de esto se considera atascado y se libera. */
const STUCK_PROCESSING_MS = MS_PER_HOUR;
/** Conversación en BOT sin respuesta automática tras este tiempo: el cron la atiende. */
const AI_AWAITING_MS = 60 * 1000;
/** Intento de IA en `pending` más tiempo que esto: el proceso se interrumpió. */
const AI_STALE_MS = 3 * 60 * 1000;

export interface SweepSummary {
  webhookReleased: number;
  webhookClaimed: number;
  webhookDone: number;
  webhookIgnored: number;
  webhookFailed: number;
  outboxClaimed: number;
  outboxSent: number;
  reconcileChecked: number;
  reconcileConfirmed: number;
  aiRecovered: number;
  aiAttempted: number;
}

/**
 * Barrido periódico (Cron Trigger): libera eventos atascados, procesa pendientes,
 * concilia envíos inciertos y despacha el outbox. Es el respaldo de `waitUntil`;
 * ambos pueden solaparse sin duplicar trabajo porque cada cola se reclama de forma
 * atómica.
 */
export async function runSweep(
  env: Env,
  container: Container = createContainer(env),
): Promise<SweepSummary> {
  const nowUtc = toIsoUtc(container.clock.now());
  const cutoff = toIsoUtc(new Date(container.clock.now().getTime() - STUCK_PROCESSING_MS));
  await container.repos.callbackTokens.deleteExpired(nowUtc);
  const webhookReleased = await container.repos.webhookEvents.releaseStuck(cutoff);
  const webhook = await container.processPendingWebhookEvents.run(100);
  const reconcile = await container.reconcileUncertainOutbox.run(50);
  const outbox = await container.dispatchOutbox.run(50);
  const ai = await sweepAi(container);
  return {
    webhookReleased,
    webhookClaimed: webhook.claimed,
    webhookDone: webhook.done,
    webhookIgnored: webhook.ignored,
    webhookFailed: webhook.failed,
    outboxClaimed: outbox.claimed,
    outboxSent: outbox.results.filter((r) => r.outcome === 'sent').length,
    reconcileChecked: reconcile.checked,
    reconcileConfirmed: reconcile.confirmed,
    aiRecovered: ai.recovered,
    aiAttempted: ai.attempted,
  };
}

/**
 * Red de seguridad de la IA: ningún cliente queda sin respuesta si `waitUntil` se
 * cortó. Los intentos colgados pasan a humano y las conversaciones en BOT sin
 * intento para su último mensaje se procesan ahora.
 */
async function sweepAi(container: Container): Promise<{ recovered: number; attempted: number }> {
  const generate = container.generateAiReply;
  if (generate === null) return { recovered: 0, attempted: 0 };
  const now = container.clock.now().getTime();

  const stale = await container.repos.aiReplies.listStalePending(
    toIsoUtc(new Date(now - AI_STALE_MS)),
    20,
  );
  for (const record of stale) await generate.recoverStale(record.id, record.conversationId);

  const awaiting = await container.repos.conversations.listBotAwaitingReply(
    toIsoUtc(new Date(now - AI_AWAITING_MS)),
    10,
  );
  for (const conversation of awaiting) await generate.execute(conversation.id);
  return { recovered: stale.length, attempted: awaiting.length };
}
