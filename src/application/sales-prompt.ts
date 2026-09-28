import { z } from 'zod';

import type { AiAssessment } from '../domain/ai-policy.ts';
import { approvedQuotes, formatMoney, type CatalogItem } from '../domain/catalog.ts';
import type { Message } from '../domain/message.ts';
import type { AiChatMessage } from '../ports/ai-provider.ts';

/** Versionar cada cambio del prompt para poder comparar resultados (plan §7). */
export const SALES_PROMPT_VERSION = 'sales-v1';

/** Mensajes previos que se envían como contexto; el resto se omite (minimización). */
export const PROMPT_HISTORY_LIMIT = 12;

const INTENTS = [
  'precio',
  'disponibilidad',
  'pedido',
  'envio',
  'postventa',
  'reclamo',
  'saludo',
  'otro',
] as const;
const STAGES = ['nuevo', 'interesado', 'objecion', 'listo_para_comprar', 'posventa'] as const;
const HANDOFFS = [
  'none',
  'requested_human',
  'negotiation',
  'bulk_purchase',
  'ready_to_buy',
  'complaint',
  'sensitive',
  'out_of_scope',
] as const;

/** Esquema que se pide al proveedor en modo JSON. */
export const SALES_REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    stage: { type: 'string', enum: STAGES },
    priority: { type: 'string', enum: ['alta', 'media', 'baja'] },
    handoff_reason: { type: 'string', enum: HANDOFFS },
    quantity_requested: { type: ['integer', 'null'] },
    reply: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['intent', 'stage', 'priority', 'handoff_reason', 'reply', 'confidence'],
};

const outputSchema = z.object({
  intent: z.enum(INTENTS).catch('otro'),
  stage: z.enum(STAGES).catch('nuevo'),
  priority: z.enum(['alta', 'media', 'baja']).catch('media'),
  handoff_reason: z.enum(HANDOFFS),
  quantity_requested: z.number().int().min(0).max(100).nullable().optional().catch(null),
  reply: z.string().max(1000),
  confidence: z.number().min(0).max(1),
});

/**
 * Valida la salida del modelo. Acepta JSON rodeado de texto (algunos modelos lo
 * envuelven en ``` o frases). Devuelve `null` si no cumple: eso lleva a un humano.
 */
export function parseSalesReply(raw: string): AiAssessment | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = outputSchema.safeParse(json);
  if (!parsed.success) return null;
  const o = parsed.data;
  return {
    intent: o.intent,
    stage: o.stage,
    priority: o.priority,
    handoffReason: o.handoff_reason,
    quantityRequested: o.quantity_requested ?? null,
    reply: o.reply,
    confidence: o.confidence,
  };
}

function describeItem(item: CatalogItem): string {
  const quotes = approvedQuotes(item);
  const lines = quotes.map((q) =>
    q.qty === 1
      ? `  - 1 unidad: ${formatMoney(q.unitPriceMinor, item.currency)}`
      : `  - ${q.qty} unidades: ${formatMoney(q.unitPriceMinor, item.currency)} c/u (total ${formatMoney(q.totalMinor, item.currency)})`,
  );
  const facts = item.facts.map((f) => `  - ${f}`).join('\n');
  return [
    `* ${item.name}: ${item.description}`,
    `  Disponibles: ${item.quantityAvailable}.`,
    `  Precios aprobados (los únicos que puedes decir):`,
    ...lines,
    facts.length > 0 ? `  Datos aprobados:\n${facts}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

export interface SalesPromptInput {
  businessName: string;
  catalog: CatalogItem[];
  history: Message[];
  isFirstAiReply: boolean;
}

/** Construye los mensajes para el proveedor. El piso de negociación nunca se incluye. */
export function buildSalesPrompt(input: SalesPromptInput): AiChatMessage[] {
  const handoffQty = Math.min(...input.catalog.map((i) => i.handoffMinQty), 99);
  const system = `Eres el asistente virtual de ventas de ${input.businessName}, una tienda de mascotas en República Dominicana. Atiendes mensajes directos de Instagram.
Objetivo: vender los cachorros al precio aprobado más alto posible, con calidez y sin presionar.

CATÁLOGO (única fuente de verdad):
${input.catalog.map(describeItem).join('\n')}

REGLAS:
1. Solo menciona precios exactamente como aparecen arriba. Nunca inventes descuentos, rebajas, promociones, vacunas, pedigrí, garantías, envíos, formas de pago, ubicación, horarios ni enlaces.
2. Para 1 o 2 cachorros da el precio de 1 unidad. Destaca primero el valor (raza, edad, que están listos) y luego el precio si no lo pidieron directo; si lo pidieron, dalo directo.
3. Si el cliente regatea, pide rebaja o descuento, propone otro precio o pregunta si "lo dejas en" algo: handoff_reason = "negotiation". No aceptes ni propongas ningún otro precio.
4. Si el cliente quiere ${handoffQty} o más cachorros: menciona la oferta aprobada exacta para esa cantidad y usa handoff_reason = "bulk_purchase". Si el cliente dice que busca varios, puedes mencionar las ofertas por volumen.
5. Si el cliente confirma que quiere comprar o reservar: handoff_reason = "ready_to_buy" (el encargado coordina pago y entrega).
6. Si pide hablar con una persona: "requested_human". Queja o molestia: "complaint". Temas delicados (salud de una mascota ya comprada, pagos, datos personales): "sensitive". Preguntas que no puedes responder con los datos aprobados: "out_of_scope".
7. Nunca pidas contraseñas, datos de tarjetas ni documentos.
8. Escribe en español cálido y natural, máximo 3 frases, como mucho un emoji. No escribas despedidas de traspaso ("te comunico con..."): el sistema las agrega.
9. ${input.isFirstAiReply ? 'Es tu primera respuesta: preséntate brevemente como el asistente virtual de ' + input.businessName + '.' : 'Ya te presentaste antes; no lo repitas.'}
10. quantity_requested: número de cachorros que el cliente quiere si lo dijo, si no null. confidence: de 0 a 1, qué tan seguro estás de que tu respuesta es correcta y cumple las reglas.

Responde SOLO con un objeto JSON con las claves: intent, stage, priority, handoff_reason, quantity_requested, reply, confidence.`;

  const messages: AiChatMessage[] = [{ role: 'system', content: system }];
  for (const m of input.history) {
    const content = (m.body ?? '').trim();
    if (content.length === 0) continue;
    messages.push({ role: m.direction === 'inbound' ? 'user' : 'assistant', content });
  }
  return messages;
}
