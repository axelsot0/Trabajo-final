import { createRepositories, type Repositories } from './adapters/d1/index.ts';
import { IngestMetaWebhook } from './application/ingest-meta-webhook.ts';
import { ProcessPendingWebhookEvents } from './application/process-webhook-events.ts';
import { ReceiveCustomerMessage } from './application/receive-customer-message.ts';
import { loadAppConfig, type AppConfig } from './config.ts';
import type { Env } from './env.ts';
import { systemClock, type Clock } from './ports/clock.ts';

/** Raíz de composición: construye casos de uso con sus dependencias reales. */
export interface Container {
  config: AppConfig;
  clock: Clock;
  repos: Repositories;
  ingestMetaWebhook: IngestMetaWebhook;
  processPendingWebhookEvents: ProcessPendingWebhookEvents;
}

export function createContainer(env: Env, clock: Clock = systemClock): Container {
  const config = loadAppConfig(env);
  const repos = createRepositories(env.DB);
  const aiEnabled = config.aiMode !== 'off' && config.aiProvider !== 'disabled';

  const receiveCustomerMessage = new ReceiveCustomerMessage(
    {
      igAccounts: repos.igAccounts,
      customers: repos.customers,
      conversations: repos.conversations,
      messages: repos.messages,
      audit: repos.audit,
      clock,
    },
    { aiEnabled },
  );

  return {
    config,
    clock,
    repos,
    ingestMetaWebhook: new IngestMetaWebhook(repos.webhookEvents, clock),
    processPendingWebhookEvents: new ProcessPendingWebhookEvents({
      webhookEvents: repos.webhookEvents,
      receiveCustomerMessage,
      clock,
    }),
  };
}
