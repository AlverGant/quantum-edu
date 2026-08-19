/**
 * Máquina de estados do job de Shor — mesmo desenho do harvest do sorteio:
 *
 *   idle       ──▶ última rodada boa tem mais de RUN_PERIOD_DAYS?
 *                  submete os 3 circuitos num job só  ──▶ submitted
 *   submitted  ──▶ polling; quando completa: agrega contagens ──▶ idle
 *
 * Só existe um job em voo por vez, persistido em `shor_state`. Sem esse
 * estado, cada tick de 5 minutos abriria um job novo e queimaria os 10
 * minutos mensais de QPU — que são COMPARTILHADOS com o harvest do sorteio
 * na mesma instância IBM — numa tarde.
 */

import { IbmClient } from './ibm.ts';
import { CIRCUITS } from './circuits.gen.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IBM_API_KEY?: string;
  IBM_CRN?: string;
  ADMIN_TOKEN?: string;
  RUN_PERIOD_DAYS?: string;
}

/**
 * Converte as amostras hex da IBM ("0x5", uma por shot) num histograma
 * {valor: contagem}. O valor é o registrador de contagem inteiro — para os
 * nossos circuitos, o k da estimativa de fase.
 */
export function aggregate(samples: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of samples) {
    const v = parseInt(s, 16); // parseInt aceita o prefixo 0x
    if (Number.isNaN(v)) throw new Error(`amostra hex inválida: ${s.slice(0, 24)}`);
    const key = String(v);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

interface StateRow {
  state: string;
  job_id: string | null;
  backend: string | null;
  run_id: number | null;
  updated_at: string | null;
}

async function readState(db: D1Database): Promise<StateRow> {
  const row = await db.prepare('SELECT state, job_id, backend, run_id, updated_at FROM shor_state WHERE id = 1').first<StateRow>();
  if (row) return row;
  await db.prepare("INSERT OR IGNORE INTO shor_state (id, state) VALUES (1, 'idle')").run();
  return { state: 'idle', job_id: null, backend: null, run_id: null, updated_at: null };
}

/** Um tick da máquina. Chamado pelo cron (a cada 5 min) e pelo admin com force. */
export async function tick(env: Env, force = false): Promise<string> {
  if (!env.IBM_API_KEY || !env.IBM_CRN) return 'sem credenciais IBM — desligado';
  const db = env.DB;
  const st = await readState(db);

  if (st.state === 'submitted' && st.job_id) {
    return poll(env, st);
  }

  // idle: está na hora de rodar de novo?
  const periodDays = Number(env.RUN_PERIOD_DAYS ?? '7');
  if (!force) {
    const last = await db
      .prepare("SELECT completed_at FROM shor_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1")
      .first<{ completed_at: string }>();
    if (last?.completed_at) {
      const age = Date.now() - Date.parse(last.completed_at);
      if (age < periodDays * 86_400_000) return `próxima rodada em ${Math.ceil(periodDays - age / 86_400_000)}d`;
    }
    // Rodada anterior falhou há pouco? Espera 6h antes de tentar de novo,
    // para um backend em manutenção não virar um loop de jobs queimados.
    const lastAny = await db
      .prepare('SELECT created_at, status FROM shor_runs ORDER BY id DESC LIMIT 1')
      .first<{ created_at: string; status: string }>();
    if (lastAny && lastAny.status !== 'ok' && Date.now() - Date.parse(lastAny.created_at) < 6 * 3_600_000) {
      return 'última tentativa falhou — aguardando 6h';
    }
  }

  return submit(env);
}

async function submit(env: Env): Promise<string> {
  const ibm = new IbmClient({ apiKey: env.IBM_API_KEY!, crn: env.IBM_CRN! });

  // Os QASM são pré-transpilados por backend: só um backend da lista serve.
  const targets = Object.keys(CIRCUITS[0].backends);
  let backend: string | null = null;
  for (const name of targets) {
    try {
      const st = await ibm.status(name);
      if (st.status === 'active') {
        backend = name;
        break;
      }
    } catch {
      // Backend fora do ar ou removido da conta: tenta o próximo.
    }
  }
  if (!backend) throw new Error(`nenhum backend-alvo ativo (${targets.join(', ')})`);

  const pubs = CIRCUITS.map((c) => ({ qasm: c.backends[backend!].qasm, shots: c.shots }));
  const jobId = await ibm.submitSampler(backend, pubs);

  const run = await env.DB.prepare(
    "INSERT INTO shor_runs (created_at, backend, job_id, status) VALUES (datetime('now'), ?, ?, 'running') RETURNING id",
  )
    .bind(backend, jobId)
    .first<{ id: number }>();
  await env.DB.prepare(
    "UPDATE shor_state SET state = 'submitted', job_id = ?, backend = ?, run_id = ?, updated_at = datetime('now') WHERE id = 1",
  )
    .bind(jobId, backend, run!.id)
    .run();
  return `job ${jobId} submetido em ${backend}`;
}

async function poll(env: Env, st: StateRow): Promise<string> {
  const ibm = new IbmClient({ apiKey: env.IBM_API_KEY!, crn: env.IBM_CRN! });
  const job = await ibm.job(st.job_id!);

  if (job.status === 'Queued' || job.status === 'Running') {
    return `job ${st.job_id}: ${job.status}`;
  }

  if (job.status !== 'Completed') {
    await env.DB.prepare(
      "UPDATE shor_runs SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?",
    )
      .bind(`${job.status}: ${job.reason ?? 'sem motivo'}`, st.run_id)
      .run();
    await env.DB.prepare("UPDATE shor_state SET state = 'idle', job_id = NULL, updated_at = datetime('now') WHERE id = 1").run();
    return `job ${st.job_id} falhou: ${job.status}`;
  }

  const samples = await ibm.results(st.job_id!);
  if (samples.length !== CIRCUITS.length) {
    throw new Error(`esperava ${CIRCUITS.length} PUBs, veio ${samples.length}`);
  }
  const results = CIRCUITS.map((c, i) => ({
    id: c.id,
    shots: c.shots,
    counts: aggregate(samples[i]),
  }));

  // `bss.seconds` costuma vir nulo em job recém-concluído (só é preenchido
  // minutos depois) — gravamos o que houver, sem bloquear.
  await env.DB.prepare(
    "UPDATE shor_runs SET status = 'ok', results_json = ?, charged_seconds = ?, completed_at = datetime('now') WHERE id = ?",
  )
    .bind(JSON.stringify(results), job.charged, st.run_id)
    .run();
  await env.DB.prepare("UPDATE shor_state SET state = 'idle', job_id = NULL, updated_at = datetime('now') WHERE id = 1").run();
  return `job ${st.job_id} completo`;
}

/** Última rodada boa + metadados dos circuitos, no formato que o site consome. */
export async function latestRun(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, created_at, completed_at, backend, job_id, charged_seconds, results_json FROM shor_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1",
  ).first<{
    id: number;
    created_at: string;
    completed_at: string;
    backend: string;
    job_id: string;
    charged_seconds: number | null;
    results_json: string;
  }>();

  const body = row
    ? {
        run: {
          id: row.id,
          created_at: row.created_at,
          completed_at: row.completed_at,
          backend: row.backend,
          job_id: row.job_id,
          charged_seconds: row.charged_seconds,
          results: JSON.parse(row.results_json),
        },
      }
    : { run: null };

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // O dado muda no máximo 1x por semana; 1h de cache tira a D1 do caminho.
      'cache-control': 'public, max-age=3600',
    },
  });
}
