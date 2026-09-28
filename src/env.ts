/**
 * Bindings y variables del Worker.
 *
 * `Cloudflare.Env` lo genera `wrangler types` a partir de `wrangler.jsonc`
 * (bindings y `vars`). Aquí se amplía con los secretos, que no aparecen en la
 * configuración versionada y por eso se declaran opcionales: su ausencia no
 * debe romper el arranque del Worker sino producir un error explícito en la
 * ruta que los necesita (ver `config.ts`).
 */
// La ampliación por namespace es el mecanismo que usa Cloudflare para `Cloudflare.Env`.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Cloudflare {
    interface Env {
      META_APP_SECRET?: string;
      META_VERIFY_TOKEN?: string;
      META_ACCESS_TOKEN?: string;
      TELEGRAM_BOT_TOKEN?: string;
      TELEGRAM_WEBHOOK_SECRET?: string;
      AI_EXTERNAL_ENDPOINT?: string;
      AI_EXTERNAL_API_KEY?: string;
    }
  }
}

export type Env = Cloudflare.Env;
