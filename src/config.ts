import { z } from 'zod';

import type { Env } from './env.ts';

const nonEmpty = z.string().trim().min(1);

const appConfigSchema = z.object({
  appEnv: z.enum(['development', 'test', 'production']),
  businessTimezone: nonEmpty,
  aiProvider: z.enum(['workers-ai', 'external-http', 'disabled']),
  aiMode: z.enum(['off', 'review', 'auto']),
  metaGraphVersion: z.string().regex(/^v\d+\.\d+$/, 'formato esperado: vNN.N'),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Valida las variables no sensibles. Se llama una vez por request y falla de
 * forma temprana y legible si `wrangler.jsonc` trae un valor inesperado.
 */
export function loadAppConfig(env: Env): AppConfig {
  return appConfigSchema.parse({
    appEnv: env.APP_ENV,
    businessTimezone: env.BUSINESS_TIMEZONE,
    aiProvider: env.AI_PROVIDER,
    aiMode: env.AI_MODE,
    metaGraphVersion: env.META_GRAPH_VERSION,
  });
}

export class MissingSecretError extends Error {
  constructor(public readonly secretName: string) {
    super(`Secreto no configurado: ${secretName}`);
    this.name = 'MissingSecretError';
  }
}

/** Devuelve el secreto o lanza `MissingSecretError`; nunca registra el valor. */
export function requireSecret(env: Env, name: SecretName): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MissingSecretError(name);
  }
  return value;
}

export type SecretName =
  | 'META_APP_SECRET'
  | 'META_VERIFY_TOKEN'
  | 'META_ACCESS_TOKEN'
  | 'TELEGRAM_BOT_TOKEN'
  | 'TELEGRAM_WEBHOOK_SECRET'
  | 'AI_EXTERNAL_ENDPOINT'
  | 'AI_EXTERNAL_API_KEY';
