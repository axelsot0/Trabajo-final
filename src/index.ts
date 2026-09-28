import type { Env } from './env.ts';
import { handleFetch } from './http/app.ts';
import { runSweep } from './jobs/sweep.ts';

export default {
  fetch: handleFetch,

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      runSweep(env).catch((err: unknown) => {
        console.error('sweep_failed', { error: err instanceof Error ? err.name : 'unknown' });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
