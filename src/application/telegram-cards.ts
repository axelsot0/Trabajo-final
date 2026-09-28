import type { Conversation } from '../domain/conversation.ts';
import type { Customer } from '../domain/customer.ts';
import { formatLocal } from '../domain/local-time.ts';
import type { Message } from '../domain/message.ts';

/** Máximo de caracteres de cada mensaje del cliente que se muestra al agente. */
const BODY_PREVIEW_CHARS = 280;
export const CARD_HISTORY_LIMIT = 6;

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const modeLabel: Record<Conversation['mode'], string> = {
  BOT: 'Bot',
  PENDING_HUMAN: 'Pendiente de humano',
  HUMAN: 'En atención humana',
  CLOSED: 'Cerrada',
};

const priorityLabel: Record<Conversation['priority'], string> = {
  alta: 'alta',
  media: 'media',
  baja: 'baja',
};

export interface CardInput {
  conversation: Conversation;
  customer: Customer;
  messages: Message[];
  assignedName: string | null;
  timeZone: string;
}

/**
 * Tarjeta de contexto de una conversación. Se envía como texto plano y muestra lo
 * mínimo necesario para atender: sin username ni datos de perfil.
 */
export function renderConversationCard(input: CardInput): string {
  const { conversation: c, customer, messages, assignedName, timeZone } = input;
  const lines: string[] = [];
  lines.push(`Conversación #${shortId(c.id)} · cliente ${shortId(customer.id)}`);
  lines.push(`Estado: ${modeLabel[c.mode]} · prioridad ${priorityLabel[c.priority]}`);
  if (c.intent !== null || c.stage !== null) {
    lines.push(`Triaje: ${c.intent ?? '—'} · etapa ${c.stage ?? '—'}`);
  }
  if (assignedName !== null) lines.push(`Agente: ${assignedName}`);
  if (c.lastCustomerMessageAtUtc !== null) {
    lines.push(`Último mensaje del cliente: ${formatLocal(c.lastCustomerMessageAtUtc, timeZone)}`);
  }
  lines.push('');
  for (const m of messages.slice(-CARD_HISTORY_LIMIT)) {
    const who = m.direction === 'inbound' ? 'Cliente' : m.origin === 'ai' ? 'Bot' : 'Negocio';
    const when = m.providerTimestampUtc ?? m.ingestedAtUtc;
    const body =
      m.body !== null
        ? truncate(m.body, BODY_PREVIEW_CHARS)
        : `[${m.contentType === 'text' ? 'sin texto' : m.contentType}]`;
    lines.push(`${formatLocal(when, timeZone)} ${who}: ${body}`);
  }
  lines.push('');
  lines.push('Responde con Reply a esta tarjeta para escribir al cliente.');
  return lines.join('\n');
}

export interface ListEntry {
  conversation: Conversation;
  lastText: string | null;
  assignedName: string | null;
}

export function renderConversationList(
  title: string,
  entries: ListEntry[],
  page: number,
  totalPages: number,
  timeZone: string,
): string {
  if (entries.length === 0) return `${title}\n\nNo hay conversaciones en esta lista.`;
  const lines = [`${title} · página ${page + 1}/${Math.max(totalPages, 1)}`, ''];
  entries.forEach((e, i) => {
    const c = e.conversation;
    const when =
      c.lastCustomerMessageAtUtc === null
        ? ''
        : ` · ${formatLocal(c.lastCustomerMessageAtUtc, timeZone)}`;
    const agent = e.assignedName === null ? '' : ` · ${e.assignedName}`;
    lines.push(
      `${i + 1}. #${shortId(c.id)} · ${modeLabel[c.mode]} · ${priorityLabel[c.priority]}${when}${agent}`,
    );
    if (e.lastText !== null) lines.push(`   «${truncate(e.lastText, 80)}»`);
  });
  return lines.join('\n');
}
