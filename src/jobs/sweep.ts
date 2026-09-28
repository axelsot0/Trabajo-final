import { createContainer } from '../container.ts';
import { MS_PER_HOUR, toIsoUtc } from '../domain/time.ts';
import type { Env } from '../env.ts';

/** Un evento en `processing` durante más de esto se considera atascado y se libera. */
const STUCK_PROCESSING_MS = MS_PER_HOUR;

export interface SweepSummary {
  released: number;
  claimed: number;
  done: number;
  ignored: number;
  failed: number;
}

/**
 * Barrido periódico (Cron Trigger): libera eventos atascados y procesa pendientes.
 * Es el respaldo de `waitUntil`; ambos pueden solaparse sin duplicar trabajo.
 */
export async function runSweep(env: Env): Promise<SweepSummary> {
  const container = createContainer(env);
  const cutoff = toIsoUtc(new Date(container.clock.now().getTime() - STUCK_PROCESSING_MS));
  const released = await container.repos.webhookEvents.releaseStuck(cutoff);
  const processed = await container.processPendingWebhookEvents.run(100);
  return { released, ...processed };
}
