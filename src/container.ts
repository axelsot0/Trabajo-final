import { createRepositories, type Repositories } from './adapters/d1/index.ts';
import { MetaInstagramGateway } from './adapters/meta/instagram-gateway.ts';
import { TelegramBotApiGateway } from './adapters/telegram/bot-api-gateway.ts';
import { AgentActions } from './application/agent-actions.ts';
import { DispatchOutbox } from './application/dispatch-outbox.ts';
import {
  HandleTelegramUpdate,
  type ActionHandler,
  type AgentTextHandler,
} from './application/handle-telegram-update.ts';
import { IngestMetaWebhook } from './application/ingest-meta-webhook.ts';
import { ProcessPendingWebhookEvents } from './application/process-webhook-events.ts';
import { QueueOutboundText } from './application/queue-outbound-text.ts';
import { ReceiveCustomerMessage } from './application/receive-customer-message.ts';
import { ReconcileEcho } from './application/reconcile-echo.ts';
import { ReconcileUncertainOutbox } from './application/reconcile-uncertain-outbox.ts';
import { SendAgentReply } from './application/send-agent-reply.ts';
import {
  TelegramActionHandler,
  TelegramAgentTextHandler,
} from './application/telegram-agent-handlers.ts';
import { TelegramNotifier } from './application/telegram-notifier.ts';
import { loadAppConfig, requireSecret, resolveTokenReference, type AppConfig } from './config.ts';
import type { Env } from './env.ts';
import { systemClock, type Clock } from './ports/clock.ts';
import type { InstagramGateway } from './ports/instagram-gateway.ts';
import type { TelegramGateway } from './ports/telegram-gateway.ts';

/** Raíz de composición: construye casos de uso con sus dependencias reales. */
export interface Container {
  config: AppConfig;
  clock: Clock;
  repos: Repositories;
  instagramGateway: InstagramGateway;
  telegramGateway: TelegramGateway;
  notifier: TelegramNotifier;
  handleTelegramUpdate: HandleTelegramUpdate;
  agentActions: AgentActions;
  sendAgentReply: SendAgentReply;
  ingestMetaWebhook: IngestMetaWebhook;
  processPendingWebhookEvents: ProcessPendingWebhookEvents;
  queueOutboundText: QueueOutboundText;
  dispatchOutbox: DispatchOutbox;
  reconcileUncertainOutbox: ReconcileUncertainOutbox;
}

export interface ContainerOverrides {
  clock?: Clock;
  instagramGateway?: InstagramGateway;
  telegramGateway?: TelegramGateway;
  agentText?: AgentTextHandler;
  actions?: ActionHandler;
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

  const telegramGateway =
    overrides.telegramGateway ??
    new TelegramBotApiGateway({ resolveToken: () => requireSecret(env, 'TELEGRAM_BOT_TOKEN') });

  const notifier = new TelegramNotifier({
    gateway: telegramGateway,
    employees: repos.employees,
    conversations: repos.conversations,
    customers: repos.customers,
    messages: repos.messages,
    links: repos.telegramLinks,
    tokens: repos.callbackTokens,
    clock,
    timeZone: config.businessTimezone,
  });

  const queueOutboundText = new QueueOutboundText({
    conversations: repos.conversations,
    igAccounts: repos.igAccounts,
    messages: repos.messages,
    outbox: repos.outbox,
    clock,
  });
  const dispatchOutbox = new DispatchOutbox({
    outbox: repos.outbox,
    messages: repos.messages,
    conversations: repos.conversations,
    customers: repos.customers,
    igAccounts: repos.igAccounts,
    audit: repos.audit,
    gateway: instagramGateway,
    clock,
  });
  const agentActions = new AgentActions({
    conversations: repos.conversations,
    employees: repos.employees,
    outcomes: repos.outcomes,
    audit: repos.audit,
    clock,
  });
  const sendAgentReply = new SendAgentReply(queueOutboundText, dispatchOutbox);
  const handlerDeps = {
    actions: agentActions,
    sendAgentReply,
    notifier,
    links: repos.telegramLinks,
    employees: repos.employees,
    clock,
    defaultCurrency: config.defaultCurrency,
  };
  const agentTextHandler = new TelegramAgentTextHandler(handlerDeps);
  const actionHandler = new TelegramActionHandler(handlerDeps, agentTextHandler);

  const handleTelegramUpdate = new HandleTelegramUpdate({
    gateway: telegramGateway,
    notifier,
    employees: repos.employees,
    conversations: repos.conversations,
    messages: repos.messages,
    links: repos.telegramLinks,
    tokens: repos.callbackTokens,
    clock,
    timeZone: config.businessTimezone,
    agentText: overrides.agentText ?? agentTextHandler,
    actions: overrides.actions ?? actionHandler,
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
    telegramGateway,
    notifier,
    handleTelegramUpdate,
    ingestMetaWebhook: new IngestMetaWebhook(repos.webhookEvents, clock),
    processPendingWebhookEvents: new ProcessPendingWebhookEvents({
      webhookEvents: repos.webhookEvents,
      conversations: repos.conversations,
      receiveCustomerMessage,
      reconcileEcho,
      handleTelegramUpdate,
      notifier,
      clock,
    }),
    agentActions,
    sendAgentReply,
    queueOutboundText,
    dispatchOutbox,
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
