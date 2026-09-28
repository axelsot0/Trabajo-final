import { describe, expect, it } from 'vitest';

import {
  decideAiAction,
  detectRuleSignals,
  HOLDING_TEXT,
  type AiAssessment,
} from '../../src/domain/ai-policy.ts';
import { approvedAmounts } from '../../src/domain/catalog.ts';
import { YORKIES } from '../support/catalog.ts';

const approved = approvedAmounts([YORKIES]);

function assessment(overrides: Partial<AiAssessment> = {}): AiAssessment {
  return {
    intent: 'precio',
    stage: 'interesado',
    priority: 'media',
    handoffReason: 'none',
    quantityRequested: null,
    reply: 'Tenemos yorkies de 2 meses a RD$21,000 cada uno. 🐶',
    confidence: 0.9,
    ...overrides,
  };
}

const base = {
  mode: 'auto' as const,
  minConfidence: 0.6,
  unapprovedInReply: [],
  handoffMinQty: 3,
  greetingReply: '¿En qué te puedo ayudar? 🐶',
  fallbackReply: 'Con gusto te ayudo 🐶',
};
const noRules = { reason: null, quantity: null, greetingOnly: false };

describe('detectRuleSignals', () => {
  it.each([
    ['¿Me lo dejas en 17 mil?', 'negotiation'],
    ['¿tienen algún descuento?', null],
    ['Y si quiero comprar varios ? Hacen algún descuento?', null],
    ['Rebájamelo un poco', 'negotiation'],
    ['pásame con el encargado', 'requested_human'],
    ['no quiero hablar con un bot', 'requested_human'],
    ['Hola', null],
    ['te doy 15000 ahora mismo', 'negotiation'],
    ['¿Cuál es el último precio?', 'negotiation'],
    ['quiero hablar con una persona', 'requested_human'],
    ['Me interesan los 5 perritos', 'bulk_purchase'],
    ['quiero tres cachorros', 'bulk_purchase'],
    ['Hola, ¿cuánto cuesta un yorkie?', null],
    ['¿Tienen disponibles 2 cachorros?', null],
  ])('%s → %s', (text, reason) => {
    expect(detectRuleSignals(text, approved, 3).reason).toBe(reason);
  });
});

describe('decideAiAction', () => {
  it('responde solo cuando todo cumple las reglas', () => {
    expect(decideAiAction({ ...base, assessment: assessment(), rules: noRules })).toEqual({
      kind: 'reply',
      text: 'Tenemos yorkies de 2 meses a RD$21,000 cada uno. 🐶',
      code: 'auto_reply',
    });
  });

  it('ante un regateo nunca usa el texto del modelo y avisa con prioridad alta', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ reply: 'Te lo dejo en 19 mil' }),
      rules: { reason: 'negotiation', quantity: null, greetingOnly: false },
    });
    expect(action).toMatchObject({
      kind: 'handoff',
      reason: 'price_negotiation',
      priority: 'alta',
      customerText: HOLDING_TEXT.sales,
      salesAlert: true,
    });
  });

  it('en compra por volumen informa la oferta aprobada y traspasa', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({
        handoffReason: 'bulk_purchase',
        quantityRequested: 3,
        reply: 'Si te llevas 3 quedan en RD$18,000 c/u (RD$54,000).',
      }),
      rules: noRules,
    });
    expect(action.kind).toBe('handoff');
    if (action.kind !== 'handoff') return;
    expect(action.reason).toBe('bulk_purchase');
    expect(action.customerText).toContain('RD$54,000');
    expect(action.customerText).toContain('encargado');
  });

  it('la cantidad detectada por reglas fuerza el traspaso aunque el modelo no lo marque', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ reply: 'Claro, cuestan RD$21,000.' }),
      rules: { reason: null, quantity: 5, greetingOnly: false },
    });
    expect(action).toMatchObject({ kind: 'handoff', reason: 'bulk_purchase' });
  });

  it('ignora un "volumen" del modelo cuando el cliente pidió menos del mínimo', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ handoffReason: 'bulk_purchase', quantityRequested: 2 }),
      rules: noRules,
    });
    expect(action.kind).toBe('reply');
  });

  it('un saludo solo se responde con el texto fijo aunque el modelo quiera traspasar', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ handoffReason: 'out_of_scope', reply: 'Si necesitas algo más...' }),
      rules: detectRuleSignals('Hola, buenas noches', approved, 3),
    });
    expect(action).toEqual({
      kind: 'reply',
      text: '¿En qué te puedo ayudar? 🐶',
      code: 'auto_reply',
    });
  });

  it('ignora un "pidió una persona" que el cliente nunca escribió', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({
        handoffReason: 'requested_human',
        reply: 'Una persona del equipo te responde en breve.',
      }),
      rules: detectRuleSignals('¿y qué edad tienen?', approved, 3),
    });
    expect(action).toEqual({ kind: 'reply', text: 'Con gusto te ayudo 🐶', code: 'auto_reply' });
  });

  it('un precio no aprobado en la respuesta bloquea el envío', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ reply: 'Te sale en RD$19,500' }),
      rules: noRules,
      unapprovedInReply: [19_500],
    });
    expect(action).toMatchObject({
      kind: 'handoff',
      handoff: 'unapproved_price',
      customerText: HOLDING_TEXT.generic,
    });
  });

  it('baja confianza pasa a humano', () => {
    const action = decideAiAction({
      ...base,
      assessment: assessment({ confidence: 0.3 }),
      rules: noRules,
    });
    expect(action).toMatchObject({ kind: 'handoff', reason: 'low_confidence' });
  });

  it('en modo revisión nunca escribe al cliente', () => {
    const action = decideAiAction({
      ...base,
      mode: 'review',
      assessment: assessment(),
      rules: noRules,
    });
    expect(action).toMatchObject({
      kind: 'handoff',
      reason: 'ai_review_required',
      customerText: null,
    });
  });
});
