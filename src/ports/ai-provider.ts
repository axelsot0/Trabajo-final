export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiGenerateInput {
  messages: AiChatMessage[];
  model: string;
  maxOutputTokens: number;
  temperature: number;
  /** Esquema JSON que la salida debe cumplir, si el proveedor admite modo JSON. */
  jsonSchema?: Record<string, unknown>;
}

export interface AiGenerateResult {
  text: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Proveedor de IA intercambiable (ADR 0005). El dominio nunca conoce el SDK concreto. */
export interface AiProvider {
  readonly name: string;
  generate(input: AiGenerateInput): Promise<AiGenerateResult>;
}
