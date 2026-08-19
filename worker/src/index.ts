/**
 * quantum.vynstream.com — site educacional + API dos resultados de Shor.
 *
 * O Worker serve os assets estáticos de ../web e expõe:
 *   GET  /api/runs         última rodada boa no hardware real (cache 1h)
 *   GET  /api/state        estado da máquina de submissão (debug)
 *   POST /api/admin/run    força uma rodada agora (Bearer ADMIN_TOKEN)
 *
 * O cron de 5 minutos toca a máquina de estados em shor.ts.
 */

import { tick, latestRun, type Env } from './shor.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/runs' && req.method === 'GET') {
      return latestRun(env);
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const st = await env.DB.prepare('SELECT state, backend, updated_at FROM shor_state WHERE id = 1').first();
      return json({ state: st ?? { state: 'idle' } });
    }

    if (url.pathname === '/api/admin/run' && req.method === 'POST') {
      const auth = req.headers.get('authorization') ?? '';
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return json({ error: 'não autorizado' }, 401);
      }
      const force = url.searchParams.get('force') === '1';
      try {
        return json({ result: await tick(env, force) });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'rota desconhecida' }, 404);
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env).then(
        (msg) => console.log('shor:', msg),
        (err) => console.error('shor:', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
