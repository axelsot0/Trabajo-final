import type { AiGenerateInput, AiGenerateResult, AiProvider } from '../../ports/ai-provider.ts';

/** Proveedor determinista para pruebas: devuelve respuestas encoladas y guarda las peticiones. */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly requests: AiGenerateInput[] = [];
  private readonly queue: (string | Error)[] = [];

  /** Encola la siguiente respuesta: objeto (se serializa), texto crudo o error a lanzar. */
  respondWith(response: Record<string, unknown> | string | Error): this {
    this.queue.push(
      response instanceof Error || typeof response === 'string'
        ? response
        : JSON.stringify(response),
    );
    return this;
  }

  generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    this.requests.push(input);
    const next = this.queue.shift();
    if (next === undefined) return Promise.reject(new Error('fake_ai_no_response'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ text: next, usage: { inputTokens: 100, outputTokens: 50 } });
  }
}
