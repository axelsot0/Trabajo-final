import { createRepositories, type Repositories } from './adapters/d1/index.ts';
import { MetaInstagramGateway } from './adapters/meta/instagram-gateway.ts';
import { DispatchOutbox } from './application/dispatch-outbox.ts';
import { IngestMetaWebhook } from './application/ingest-meta-webhook.ts';
import { ProcessPendingWebhookEvents } from './application/process-webhook-events.ts';
import { QueueOutboundText } from './application/queue-outbound-text.ts';
import { ReceiveCustomerMessage } from './application/receive-customer-message.ts';
import { ReconcileEcho } from './application/reconcile-echo.ts';
import { ReconcileUncertainOutbox } from './application/reconcile-uncertain-outbox.ts';
import { loadAppConfig, resolveTokenReference, type AppConfig } from './config.ts';
import type { Env } from './env.ts';
import { systemClock, type Clock } from './ports/clock.ts';
import type { InstagramGateway } from './ports/instagram-gateway.ts';

/** Raíz de composición: construye casos de uso con sus dependencias reales. */
export interface Container {
  config: AppConfig;
  clock: Clock;
  repos: Repositories;
  instagramGateway: InstagramGateway;
  ingestMetaWebhook: IngestMetaWebhook;
  processPendingWebhookEvents: ProcessPendingWebhookEvents;
  queueOutboundText: QueueOutboundText;
  dispatchOutbox: DispatchOutbox;
  reconcileUncertainOutbox: ReconcileUncertainOutbox;
}

export interface ContainerOverrides {
  clock?: Clock;
  instagramGateway?: InstagramGateway;
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const config = loadAppConfig(env);
  const clock = overrides.clock ?? systemClock;
  const repos = createRepositories(env.DB);
  const aiEnabled = config.aiMode !== 'off' && config.aiProvider !== 'disabled';

  const instagramGateway =
    overrides.instagramGateway ??
    new MetaInstagramGateway({
      graphVersion: config.metaGraphVersion,
      resolveToken: (reference) => resolveTokenReference(env, reference),
    });

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
  const reconcileEcho = new ReconcileEcho({
    igAccounts: repos.igAccounts,
    customers: repos.customers,
    conversations: repos.conversations,
    messages: repos.messages,
    outbox: repos.outbox,
    clock,
  });

  return {
    config,
    clock,
    repos,
    instagramGateway,
    ingestMetaWebhook: new IngestMetaWebhook(repos.webhookEvents, clock),
    processPendingWebhookEvents: new ProcessPendingWebhookEvents({
      webhookEvents: repos.webhookEvents,
      receiveCustomerMessage,
      reconcileEcho,
      clock,
    }),
    queueOutboundText: new QueueOutboundText({
      conversations: repos.conversations,
      igAccounts: repos.igAccounts,
      messages: repos.messages,
      outbox: repos.outbox,
      clock,
    }),
    dispatchOutbox: new DispatchOutbox({
      outbox: repos.outbox,
      messages: repos.messages,
      conversations: repos.conversations,
      customers: repos.customers,
      igAccounts: repos.igAccounts,
      audit: repos.audit,
      gateway: instagramGateway,
      clock,
    }),
    reconcileUncertainOutbox: new ReconcileUncertainOutbox({
      outbox: repos.outbox,
      messages: repos.messages,
      conversations: repos.conversations,
      customers: repos.customers,
      igAccounts: repos.igAccounts,
      gateway: instagramGateway,
      clock,
    }),
  };
}
