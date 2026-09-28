import type { AiGenerateInput, AiGenerateResult, AiProvider } from '../../ports/ai-provider.ts';

/** Subconjunto del binding `Ai` que usamos; permite modelos no tipados por `wrangler types`. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface WorkersAiTextOutput {
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Workers AI (plan Free: cupo diario de Neurons). El modo JSON se pide con
 * `response_format`; algunos modelos devuelven la respuesta ya como objeto.
 */
export class WorkersAiProvider implements AiProvider {
  readonly name = 'workers-ai';

  constructor(private readonly ai: AiBinding) {}

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const request: Record<string, unknown> = {
      messages: input.messages,
      max_tokens: input.maxOutputTokens,
      temperature: input.temperature,
    };
    if (input.jsonSchema !== undefined) {
      request['response_format'] = { type: 'json_schema', json_schema: input.jsonSchema };
    }
    const raw = (await this.ai.run(input.model, request)) as WorkersAiTextOutput;
    const response = raw.response;
    const text =
      typeof response === 'string'
        ? response
        : response !== undefined && response !== null
          ? JSON.stringify(response)
          : '';
    return {
      text,
      usage: {
        ...(raw.usage?.prompt_tokens === undefined ? {} : { inputTokens: raw.usage.prompt_tokens }),
        ...(raw.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: raw.usage.completion_tokens }),
      },
    };
  }
}
