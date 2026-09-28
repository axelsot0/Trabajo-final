import type { Intent, Priority, Stage } from './conversation.ts';
import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type TriageSource = 'ai' | 'rule' | 'human';

export interface TriageEvent {
  id: Id;
  conversationId: Id;
  messageId: Id | null;
  intent: Intent | null;
  stage: Stage | null;
  priority: Priority;
  needsHuman: boolean;
  reasonCode: string | null;
  source: TriageSource;
  confidence: number | null;
  modelVersion: string | null;
  createdAtUtc: IsoUtc;
}

export type AiReplyStatus = 'pending' | 'sent' | 'escalated' | 'skipped' | 'error';

/** Registro de cada intento de respuesta automática; uno por mensaje disparador. */
export interface AiReplyRecord {
  id: Id;
  conversationId: Id;
  triggerMessageId: Id;
  status: AiReplyStatus;
  decisionCode: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  catalogVersion: number | null;
  proposedText: string | null;
  replyMessageId: Id | null;
  confidence: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  providerCalled: boolean;
  createdAtUtc: IsoUtc;
  finishedAtUtc: IsoUtc | null;
}

export type AiReplyUpdate = Partial<
  Pick<
    AiReplyRecord,
    | 'status'
    | 'decisionCode'
    | 'provider'
    | 'model'
    | 'promptVersion'
    | 'catalogVersion'
    | 'proposedText'
    | 'replyMessageId'
    | 'confidence'
    | 'inputTokens'
    | 'outputTokens'
    | 'latencyMs'
    | 'providerCalled'
    | 'finishedAtUtc'
  >
>;
