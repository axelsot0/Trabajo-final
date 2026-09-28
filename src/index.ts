import type { Env } from './env.ts';
import { handleFetch } from './http/app.ts';

export default {
  fetch: handleFetch,

  // Los trabajos programados (outbox, conciliación, cupos) se conectan en fases
  // posteriores; el handler existe para que el Cron Trigger sea configurable.
  scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): void {
    // TODO(paso 3): barrer webhook_events pendientes y outbox.
  },
} satisfies ExportedHandler<Env>;
