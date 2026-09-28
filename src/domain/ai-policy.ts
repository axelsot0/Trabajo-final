import type { EscalationReason, Intent, Priority, Stage } from './conversation.ts';
import { extractAmounts } from './catalog.ts';

/** Motivo de traspaso que la IA (o una regla) puede declarar. */
export type HandoffReason =
  | 'none'
  | 'requested_human'
  | 'negotiation'
  | 'bulk_purchase'
  | 'ready_to_buy'
  | 'complaint'
  | 'sensitive'
  | 'out_of_scope';

/** Salida de la IA ya validada contra el esquema. */
export interface AiAssessment {
  intent: Intent;
  stage: Stage;
  priority: Priority;
  handoffReason: HandoffReason;
  quantityRequested: number | null;
  reply: string;
  confidence: number;
}

export type AiMode = 'off' | 'review' | 'auto';

const escalationFor: Record<Exclude<HandoffReason, 'none'>, EscalationReason> = {
  requested_human: 'requested_human',
  negotiation: 'price_negotiation',
  bulk_purchase: 'bulk_purchase',
  ready_to_buy: 'ready_to_buy',
  complaint: 'complaint',
  sensitive: 'sensitive_topic',
  out_of_scope: 'out_of_scope',
};

/** Motivos que implican dinero u oportunidad de venta: prioridad alta y alerta al dueño. */
const salesAlertReasons = new Set<HandoffReason>(['negotiation', 'bulk_purchase', 'ready_to_buy']);

/**
 * Motivos en los que el texto propuesto por la IA puede enviarse antes del traspaso
 * (informa la oferta aprobada o confirma el interés). En el resto se envía un texto
 * fijo: la IA nunca improvisa ante un regateo o una queja.
 */
const modelTextAllowedOnHandoff = new Set<HandoffReason>(['bulk_purchase', 'ready_to_buy']);

const WORD_NUMBERS: Record<string, number> = {
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  todos: 99,
};

export interface RuleSignals {
  reason: Exclude<HandoffReason, 'none'> | null;
  quantity: number | null;
}

/**
 * Red de seguridad determinista sobre el texto del cliente, independiente del modelo:
 * contraofertas con montos no aprobados, regateo explícito, petición de persona y
 * cantidades grandes.
 */
export function detectRuleSignals(
  customerText: string,
  approvedAmounts: Set<number>,
  handoffMinQty: number,
): RuleSignals {
  const text = customerText.toLowerCase();

  const quantity = detectQuantity(text);

  if (
    /(hablar|comunicar|pasar|atender)\w*\s.{0,25}(persona|humano|encargad|asesor|dueñ|alguien)/.test(
      text,
    ) ||
    /\b(persona real|un humano)\b/.test(text)
  ) {
    return { reason: 'requested_human', quantity };
  }

  const offeredUnapproved = extractAmounts(customerText).some((a) => !approvedAmounts.has(a));
  const haggling =
    /(rebaj|descuent|m[aá]s barat|por menos|en menos|algo menos|[uú]ltimo precio|negociable|precio especial|me lo dej|lo dej[ae]s? en|te (doy|ofrezco|pago)|ofrezco|mejor precio)/.test(
      text,
    );
  if (haggling || offeredUnapproved) return { reason: 'negotiation', quantity };

  if (quantity !== null && quantity >= handoffMinQty) return { reason: 'bulk_purchase', quantity };
  return { reason: null, quantity };
}

function detectQuantity(text: string): number | null {
  const digit = /\b(\d{1,2})\s*(perr|cachorr|yorki|yorkshire)/.exec(text);
  if (digit?.[1] !== undefined) return Number(digit[1]);
  const word = /\b(tres|cuatro|cinco|seis|todos)\s+(los\s+)?(perr|cachorr|yorki|yorkshire)/.exec(
    text,
  );
  if (word?.[1] !== undefined) return WORD_NUMBERS[word[1]] ?? null;
  const theN = /\blos\s+(\d|tres|cuatro|cinco)\b/.exec(text);
  if (theN?.[1] !== undefined)
    return /\d/.test(theN[1]) ? Number(theN[1]) : (WORD_NUMBERS[theN[1]] ?? null);
  return null;
}

export type AiAction =
  | { kind: 'reply'; text: string; code: 'auto_reply' }
  | {
      kind: 'handoff';
      reason: EscalationReason;
      handoff: HandoffReason | 'low_confidence' | 'unapproved_price' | 'review';
      priority: Priority;
      /** Texto al cliente antes del traspaso; `null` = no escribir (modo revisión). */
      customerText: string | null;
      /** Borrador de la IA para el agente, si existe. */
      draft: string | null;
      salesAlert: boolean;
    };

export interface DecideInput {
  assessment: AiAssessment;
  rules: RuleSignals;
  mode: Exclude<AiMode, 'off'>;
  minConfidence: number;
  unapprovedInReply: number[];
  handoffMinQty: number;
}

export const HOLDING_TEXT: Record<'sales' | 'buy' | 'generic', string> = {
  sales: '¡Gracias! Déjame consultarlo con el encargado y te escribimos en breve. 🐶',
  buy: 'En breve te escribe el encargado para coordinar el pago y la entrega. 🐶',
  generic: 'Gracias por escribirnos. Una persona del equipo te responde en breve.',
};

/**
 * Decide qué hacer con la evaluación de la IA. Pura y determinista: las reglas
 * prevalecen sobre el modelo y cualquier duda termina en un humano.
 */
export function decideAiAction(input: DecideInput): AiAction {
  const { assessment, rules } = input;
  const quantity = Math.max(assessment.quantityRequested ?? 0, rules.quantity ?? 0);

  let handoff: HandoffReason = assessment.handoffReason;
  // Las reglas deterministas ganan cuando detectan algo que el modelo pasó por alto.
  if (rules.reason !== null && (handoff === 'none' || rules.reason === 'negotiation')) {
    handoff = rules.reason;
  }
  if (handoff === 'none' && quantity >= input.handoffMinQty) handoff = 'bulk_purchase';
  // El modelo a veces marca "volumen" con 2 unidades: la cantidad explícita manda.
  if (handoff === 'bulk_purchase' && quantity > 0 && quantity < input.handoffMinQty) {
    handoff = 'none';
  }

  const reply = assessment.reply.trim();

  if (handoff !== 'none') {
    const salesAlert = salesAlertReasons.has(handoff);
    const canUseModelText =
      modelTextAllowedOnHandoff.has(handoff) &&
      reply.length > 0 &&
      input.unapprovedInReply.length === 0;
    const holding = salesAlert
      ? handoff === 'ready_to_buy'
        ? HOLDING_TEXT.buy
        : HOLDING_TEXT.sales
      : HOLDING_TEXT.generic;
    const customerText = canUseModelText
      ? `${reply}\n\n${handoff === 'ready_to_buy' ? HOLDING_TEXT.buy : 'El encargado te escribe en breve para coordinar. 🐶'}`
      : holding;
    return {
      kind: 'handoff',
      reason: escalationFor[handoff],
      handoff,
      priority:
        salesAlert || handoff === 'complaint' || handoff === 'requested_human'
          ? 'alta'
          : assessment.priority,
      customerText: input.mode === 'review' ? null : customerText,
      draft: reply.length > 0 ? reply : null,
      salesAlert,
    };
  }

  if (input.unapprovedInReply.length > 0) {
    return {
      kind: 'handoff',
      reason: 'low_confidence',
      handoff: 'unapproved_price',
      priority: 'alta',
      customerText: input.mode === 'review' ? null : HOLDING_TEXT.generic,
      draft: reply,
      salesAlert: true,
    };
  }

  if (reply.length === 0 || assessment.confidence < input.minConfidence) {
    return {
      kind: 'handoff',
      reason: 'low_confidence',
      handoff: 'low_confidence',
      priority: assessment.priority,
      customerText: input.mode === 'review' ? null : HOLDING_TEXT.generic,
      draft: reply.length > 0 ? reply : null,
      salesAlert: false,
    };
  }

  if (input.mode === 'review') {
    return {
      kind: 'handoff',
      reason: 'ai_review_required',
      handoff: 'review',
      priority: assessment.priority,
      customerText: null,
      draft: reply,
      salesAlert: false,
    };
  }

  return { kind: 'reply', text: reply, code: 'auto_reply' };
}
