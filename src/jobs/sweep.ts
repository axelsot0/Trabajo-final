import { createContainer, type Container } from '../container.ts';
import { MS_PER_HOUR, toIsoUtc } from '../domain/time.ts';
import type { Env } from '../env.ts';

/** Un evento en `processing` durante más de esto se considera atascado y se libera. */
const STUCK_PROCESSING_MS = MS_PER_HOUR;

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
  const cutoff = toIsoUtc(new Date(container.clock.now().getTime() - STUCK_PROCESSING_MS));
  const webhookReleased = await container.repos.webhookEvents.releaseStuck(cutoff);
  const webhook = await container.processPendingWebhookEvents.run(100);
  const reconcile = await container.reconcileUncertainOutbox.run(50);
  const outbox = await container.dispatchOutbox.run(50);
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
  };
}
