import {
  decideAiAction,
  detectRuleSignals,
  HOLDING_TEXT,
  type AiAction,
  type AiAssessment,
  type AiMode,
} from '../domain/ai-policy.ts';
import {
  approvedAmounts,
  formatMoney,
  unapprovedAmounts,
  unitPriceFor,
  type CatalogItem,
} from '../domain/catalog.ts';
import { transition, type Conversation, type EscalationReason } from '../domain/conversation.ts';
import { newId, type Id } from '../domain/ids.ts';
import { localParts } from '../domain/local-time.ts';
import type { Message } from '../domain/message.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { AiProvider } from '../ports/ai-provider.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  AiReplyRepository,
  AuditRepository,
  CatalogRepository,
  ConversationRepository,
  MessageRepository,
  TriageRepository,
} from '../ports/repositories.ts';
import type { DispatchOutbox } from './dispatch-outbox.ts';
import type { QueueOutboundText } from './queue-outbound-text.ts';
import {
  buildSalesPrompt,
  type Continuation,
  parseSalesReply,
  PROMPT_HISTORY_LIMIT,
  SALES_PROMPT_VERSION,
  SALES_REPLY_JSON_SCHEMA,
} from './sales-prompt.ts';
import type { TelegramNotifier } from './telegram-notifier.ts';

export interface GenerateAiReplyConfig {
  mode: Exclude<AiMode, 'off'>;
  model: string;
  dailyLimit: number;
  minConfidence: number;
  businessName: string;
  timeZone: string;
  providerTimeoutMs: number;
}

export interface GenerateAiReplyDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  catalog: CatalogRepository;
  triage: TriageRepository;
  aiReplies: AiReplyRepository;
  audit: AuditRepository;
  queue: QueueOutboundText;
  dispatch: DispatchOutbox;
  notifier: TelegramNotifier;
  provider: AiProvider;
  clock: Clock;
}

export type GenerateOutcome =
  | 'sent'
  | 'escalated'
  | 'skipped_not_bot'
  | 'skipped_no_message'
  | 'skipped_superseded'
  | 'skipped_claimed'
  | 'skipped_not_text'
  | 'skipped_answered'
  | 'error';

type HandoffCode = Extract<AiAction, { kind: 'handoff' }>['handoff'] | 'ai_unavailable' | 'budget';

const ALERT_TITLE: Record<HandoffCode, string> = {
  negotiation: '💰 Negociación de precio: el cliente regatea o propone otro precio.',
  bulk_purchase: '📦 Compra por volumen.',
  ready_to_buy: '✅ Cliente listo para comprar: coordina pago y entrega.',
  unapproved_price: '⚠️ La IA propuso un precio no aprobado (no se envió).',
  requested_human: '🙋 El cliente pidió hablar con una persona.',
  complaint: '😠 Queja del cliente.',
  sensitive: '⚠️ Tema delicado.',
  out_of_scope: '❓ Pregunta fuera de los datos aprobados.',
  low_confidence: '🤔 La IA no está segura de la respuesta.',
  review: '📝 Borrador de la IA pendiente de revisión.',
  none: '',
  ai_unavailable: '⚠️ IA no disponible; atiende manualmente.',
  budget: '⚠️ Cupo diario de IA agotado; atiende manualmente.',
};

const PROVIDER_TIMEOUT = 'ai_timeout';

/**
 * Respuesta automática de ventas (paso 8). Reclama el mensaje disparador de forma
 * idempotente, consulta la IA con el catálogo aprobado, aplica reglas deterministas
 * y responde o traspasa a humano. Ante cualquier fallo el cliente nunca queda sin
 * atención: la conversación pasa a PENDING_HUMAN y se avisa por Telegram.
 */
export class GenerateAiReply {
  constructor(
    private readonly deps: GenerateAiReplyDeps,
    private readonly config: GenerateAiReplyConfig,
  ) {}

  async execute(conversationId: Id, triggerMessageId: Id | null = null): Promise<GenerateOutcome> {
    const { conversations, messages, aiReplies, clock } = this.deps;

    const conversation = await conversations.findById(conversationId);
    if (conversation?.mode !== 'BOT') return 'skipped_not_bot';

    const latest = await messages.findLatestInbound(conversationId);
    if (latest === null) return 'skipped_no_message';
    // Ráfaga: solo responde el último mensaje; los anteriores se cubren con él.
    if (triggerMessageId !== null && latest.id !== triggerMessageId) return 'skipped_superseded';
    if (latest.contentType !== 'text' || (latest.body ?? '').trim().length === 0) {
      return 'skipped_not_text';
    }
    // Ya se le respondió (p. ej. un agente escribió y luego devolvió el chat a la IA).
    // Se compara con nuestro reloj de ingesta: la hora de Meta no es comparable con él.
    const answered = (await messages.listRecent(conversationId, 20)).some(
      (m) => m.direction === 'outbound' && m.ingestedAtUtc > latest.ingestedAtUtc,
    );
    if (answered) return 'skipped_answered';

    const recordId = newId();
    const claimed = await aiReplies.claim({
      id: recordId,
      conversationId,
      triggerMessageId: latest.id,
      status: 'pending',
      decisionCode: null,
      provider: this.deps.provider.name,
      model: this.config.model,
      promptVersion: SALES_PROMPT_VERSION,
      catalogVersion: null,
      proposedText: null,
      replyMessageId: null,
      confidence: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      providerCalled: false,
      createdAtUtc: toIsoUtc(clock.now()),
      finishedAtUtc: null,
    });
    if (!claimed) return 'skipped_claimed';

    try {
      return await this.run(conversation, latest.id, latest.body ?? '', recordId);
    } catch (err) {
      console.error('ai_reply_failed', { error: err instanceof Error ? err.name : 'unknown' });
      await this.escalate(
        conversation,
        'ai_unavailable',
        'ai_unavailable',
        null,
        null,
        recordId,
        'error',
      );
      return 'error';
    }
  }

  /** Cierra un intento que quedó `pending` por un proceso interrumpido: pasa a humano. */
  async recoverStale(recordId: Id, conversationId: Id): Promise<void> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation?.mode === 'BOT') {
      await this.escalate(
        conversation,
        'ai_unavailable',
        'ai_unavailable',
        null,
        null,
        recordId,
        'error',
      );
    } else {
      await this.deps.aiReplies.update(recordId, {
        status: 'skipped',
        decisionCode: 'stale_not_bot',
        finishedAtUtc: toIsoUtc(this.deps.clock.now()),
      });
    }
  }

  private async run(
    conversation: Conversation,
    triggerId: Id,
    customerText: string,
    recordId: Id,
  ): Promise<GenerateOutcome> {
    const { catalog, aiReplies, messages, provider, clock } = this.deps;

    const items = await catalog.listActive();
    if (items.length === 0) {
      await this.escalate(
        conversation,
        'ai_unavailable',
        'ai_unavailable',
        null,
        null,
        recordId,
        'no_catalog',
      );
      return 'escalated';
    }
    const catalogVersion = Math.max(...items.map((i) => i.version));

    const startOfDay = new Date(clock.now());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await aiReplies.countProviderCallsSince(toIsoUtc(startOfDay));
    const history = await messages.listRecent(conversation.id, PROMPT_HISTORY_LIMIT);
    const continuation = await this.continuationOf(conversation, history);
    const opening: Opening = continuation === 'new' ? 'greet' : 'none';
    if (used >= this.config.dailyLimit) {
      await this.holdAndEscalate(
        conversation,
        'ai_budget_exhausted',
        'budget',
        items,
        recordId,
        'budget',
        opening,
      );
      return 'escalated';
    }

    const prompt = buildSalesPrompt({
      businessName: this.config.businessName,
      catalog: items,
      history,
      continuation,
    });

    const started = Date.now();
    await aiReplies.update(recordId, { providerCalled: true, catalogVersion });
    let raw: string;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      const result = await withTimeout(
        provider.generate({
          messages: prompt,
          model: this.config.model,
          maxOutputTokens: 400,
          temperature: 0.3,
          jsonSchema: SALES_REPLY_JSON_SCHEMA,
        }),
        this.config.providerTimeoutMs,
      );
      raw = result.text;
      usage = result.usage;
    } catch (err) {
      console.warn('ai_provider_error', {
        error: err instanceof Error ? err.message.slice(0, 60) : 'unknown',
      });
      await aiReplies.update(recordId, { latencyMs: Date.now() - started });
      await this.holdAndEscalate(
        conversation,
        'ai_unavailable',
        'ai_unavailable',
        items,
        recordId,
        'provider_error',
        opening,
      );
      return 'escalated';
    }
    await aiReplies.update(recordId, {
      latencyMs: Date.now() - started,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });

    const assessment = parseSalesReply(raw);
    if (assessment === null) {
      await this.holdAndEscalate(
        conversation,
        'low_confidence',
        'low_confidence',
        items,
        recordId,
        'invalid_output',
        opening,
      );
      return 'escalated';
    }
    await aiReplies.update(recordId, {
      proposedText: assessment.reply,
      confidence: assessment.confidence,
    });

    const approved = approvedAmounts(items);
    const handoffMinQty = Math.min(...items.map((i) => i.handoffMinQty));
    const action = decideAiAction({
      assessment,
      rules: detectRuleSignals(customerText, approved, handoffMinQty),
      mode: this.config.mode,
      minConfidence: this.config.minConfidence,
      unapprovedInReply: unapprovedAmounts(assessment.reply, approved),
      handoffMinQty,
    });

    await this.recordTriage(conversation.id, triggerId, assessment, action);

    if (action.kind === 'reply') {
      const text = withOpening(action.text, opening, this.greeting());
      const sent = await this.send(conversation.id, text);
      if (sent === null) {
        await this.escalate(
          conversation,
          'ai_unavailable',
          'ai_unavailable',
          null,
          items,
          recordId,
          'send_rejected',
        );
        return 'escalated';
      }
      await aiReplies.update(recordId, {
        status: 'sent',
        decisionCode: action.code,
        replyMessageId: sent,
        finishedAtUtc: toIsoUtc(clock.now()),
      });
      return 'sent';
    }

    let replyMessageId: Id | null = null;
    if (action.customerText !== null) {
      replyMessageId = await this.send(
        conversation.id,
        withOpening(action.customerText, opening, this.greeting()),
      );
    }
    await this.escalate(
      conversation,
      action.reason,
      action.handoff,
      action.draft,
      items,
      recordId,
      action.handoff,
      replyMessageId,
      assessment.quantityRequested,
    );
    return 'escalated';
  }

  /**
   * Fallo o límite sin respuesta utilizable: el cliente recibe un aviso fijo (salvo en
   * modo revisión) y la conversación pasa a humano.
   */
  private async holdAndEscalate(
    conversation: Conversation,
    reason: EscalationReason,
    code: HandoffCode,
    items: CatalogItem[],
    recordId: Id,
    decisionCode: string,
    opening: Opening,
  ): Promise<void> {
    const replyMessageId =
      this.config.mode === 'review'
        ? null
        : await this.send(
            conversation.id,
            withOpening(HOLDING_TEXT.generic, opening, this.greeting()),
          );
    await this.escalate(
      conversation,
      reason,
      code,
      null,
      items,
      recordId,
      decisionCode,
      replyMessageId,
    );
  }

  private greeting(): string {
    return greetingFor(localParts(toIsoUtc(this.deps.clock.now()), this.config.timeZone).hour);
  }

  /** ¿Conversación nueva, ya atendida por la IA o retomada después de un agente humano? */
  private async continuationOf(
    conversation: Conversation,
    history: Message[],
  ): Promise<Continuation> {
    if (conversation.modeReason === 'agent_return_to_ai') return 'after_human';
    const outbound = history.filter((m) => m.direction === 'outbound');
    if (outbound.some((m) => m.origin === 'telegram')) return 'after_human';
    if (outbound.length > 0) return 'ai';
    const { messages } = this.deps;
    const ai = await messages.countOutboundByOrigin(conversation.id, 'ai');
    const human = await messages.countOutboundByOrigin(conversation.id, 'telegram');
    return ai + human === 0 ? 'new' : 'ai';
  }

  /** Encola y despacha un texto automático. Devuelve el id del mensaje o `null` si se rechazó. */
  private async send(conversationId: Id, text: string): Promise<Id | null> {
    const queued = await this.deps.queue.execute({
      conversationId,
      text,
      senderKind: 'ai',
      senderEmployeeId: null,
      origin: 'ai',
    });
    if (!queued.ok) {
      console.warn('ai_send_rejected', { reason: queued.reason });
      return null;
    }
    await this.deps.dispatch.run(20);
    return queued.messageId;
  }

  private async recordTriage(
    conversationId: Id,
    messageId: Id,
    assessment: AiAssessment,
    action: AiAction,
  ): Promise<void> {
    // Prioridad alta se reserva para lo que necesita a una persona.
    const priority =
      action.kind === 'handoff'
        ? action.priority
        : assessment.priority === 'alta'
          ? 'media'
          : assessment.priority;
    await this.deps.triage.insert({
      id: newId(),
      conversationId,
      messageId,
      intent: assessment.intent,
      stage: assessment.stage,
      priority,
      needsHuman: action.kind === 'handoff',
      reasonCode: action.kind === 'handoff' ? action.handoff : null,
      source: 'ai',
      confidence: assessment.confidence,
      modelVersion: `${this.config.model}#${SALES_PROMPT_VERSION}`,
      createdAtUtc: toIsoUtc(this.deps.clock.now()),
    });
    await this.deps.conversations.updateTriage(conversationId, {
      intent: assessment.intent,
      stage: assessment.stage,
      priority,
    });
  }

  /**
   * Traspasa a humano: cambia el modo (si sigue en BOT), audita, registra el intento y
   * avisa por Telegram con el motivo y la guía de precios para negociar.
   */
  private async escalate(
    conversation: Conversation,
    reason: EscalationReason,
    code: HandoffCode,
    draft: string | null,
    items: CatalogItem[] | null,
    recordId: Id,
    decisionCode: string,
    replyMessageId: Id | null = null,
    quantity: number | null = null,
  ): Promise<void> {
    const { conversations, audit, aiReplies, clock } = this.deps;
    const nowUtc = toIsoUtc(clock.now());
    const current = (await conversations.findById(conversation.id)) ?? conversation;

    let escalated = false;
    if (current.mode === 'BOT') {
      const change = transition(current, { type: 'escalate', reason });
      escalated = await conversations.applyModeChange(current.id, current.version, change, nowUtc);
      if (escalated) {
        if (code === 'negotiation' || code === 'bulk_purchase' || code === 'ready_to_buy') {
          await conversations.updateTriage(current.id, {
            intent: current.intent,
            stage: current.stage,
            priority: 'alta',
          });
        }
        await audit.record({
          id: newId(),
          actorType: 'ai',
          actorId: null,
          action: 'conversation.escalated',
          entityType: 'conversation',
          entityId: current.id,
          beforeRedacted: JSON.stringify({ mode: current.mode }),
          afterRedacted: JSON.stringify({ mode: change.mode, reason, code }),
          atUtc: nowUtc,
        });
      }
    }

    await aiReplies.update(recordId, {
      status: code === 'ai_unavailable' && decisionCode === 'error' ? 'error' : 'escalated',
      decisionCode,
      replyMessageId,
      finishedAtUtc: nowUtc,
    });

    if (!escalated) return;
    try {
      await this.deps.notifier.broadcast(alertText(code, draft, items, quantity));
      await this.deps.notifier.notifyPending(current.id);
    } catch (err) {
      console.warn('ai_escalation_notify_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }
}

function alertText(
  code: HandoffCode,
  draft: string | null,
  items: CatalogItem[] | null,
  quantity: number | null,
): string {
  const lines = [ALERT_TITLE[code]];
  if (quantity !== null && quantity > 0) lines.push(`Cantidad mencionada: ${quantity}.`);
  if (
    items !== null &&
    (code === 'negotiation' ||
      code === 'bulk_purchase' ||
      code === 'ready_to_buy' ||
      code === 'unapproved_price')
  ) {
    for (const item of items) lines.push(pricingGuide(item));
  }
  if (
    draft !== null &&
    (code === 'review' || code === 'unapproved_price' || code === 'low_confidence')
  ) {
    lines.push(`Borrador IA: «${draft.slice(0, 300)}»`);
  }
  return lines.join('\n');
}

/** Guía para el agente, incluye el piso autorizado (nunca visible para la IA ni el cliente). */
function pricingGuide(item: CatalogItem): string {
  const parts = [`${item.name}: lista ${formatMoney(item.listUnitPriceMinor, item.currency)}`];
  for (const tier of [...item.volumeTiers].sort((a, b) => a.minQty - b.minQty)) {
    parts.push(
      `${tier.minQty}+: ${formatMoney(unitPriceFor(item, tier.minQty), item.currency)} c/u`,
    );
  }
  if (item.minUnitPriceMinor !== null) {
    parts.push(`piso autorizado: ${formatMoney(item.minUnitPriceMinor, item.currency)}`);
  }
  parts.push(`quedan ${item.quantityAvailable}`);
  return parts.join(' · ');
}

/** Transparencia (plan §7): la primera respuesta automática se identifica como asistente. */
type Opening = 'greet' | 'none';

/**
 * Primera respuesta de una conversación nueva: saludo corto según la hora local
 * ("Buen día" por la mañana, "Buenas" el resto). Al continuar, sin saludo.
 */
function withOpening(text: string, opening: Opening, greeting: string): string {
  const clean = text.replace(/\[Agente\]\s*/gi, '').trim();
  if (opening === 'none' || /^¡?(saludos|buen[oa]s?|buen d[ií]a|hola)\b/i.test(clean)) return clean;
  return `${greeting}. ${clean}`;
}

export function greetingFor(hour: number): string {
  return hour >= 5 && hour < 12 ? 'Buen día' : 'Buenas';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(PROVIDER_TIMEOUT));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('ai_error'));
      },
    );
  });
}
