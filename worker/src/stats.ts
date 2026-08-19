/**
 * Contador de visitas — o mesmo desenho do sorteio-quantico: nenhum IP é
 * gravado em lugar nenhum. O identificador do visitante é
 *
 *     hash(sal ‖ dia ‖ IP ‖ user-agent), truncado
 *
 * — não reverte para o IP e vira outro identificador na virada do dia UTC,
 * então "visitantes únicos" significa únicos POR DIA, somados.
 */

import type { Env } from './shor.ts';

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

interface Stats {
  pageviews: number;
  unique_visitors: number;
  countries: number;
}

async function readStats(env: Env): Promise<Stats> {
  const [counters, countries] = await env.DB.batch<{ key: string; value: number }>([
    env.DB.prepare('SELECT key, value FROM counters'),
    env.DB.prepare("SELECT 'countries' AS key, COUNT(*) AS value FROM countries"),
  ]);
  const map = new Map<string, number>();
  for (const row of [...(counters.results ?? []), ...(countries.results ?? [])]) {
    map.set(row.key, Number(row.value) || 0);
  }
  return {
    pageviews: map.get('pageviews') ?? 0,
    unique_visitors: map.get('unique_visitors') ?? 0,
    countries: map.get('countries') ?? 0,
  };
}

function bump(env: Env, key: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO counters (key, value) VALUES (?1, 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1`,
  ).bind(key);
}

export async function handleVisit(request: Request, env: Env): Promise<Response> {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  // Sem sal não contamos nada — melhor zero do que um hash previsível.
  if (!env.VISITOR_SALT) {
    return new Response(JSON.stringify({ pageviews: 0, unique_visitors: 0, countries: 0 }), { headers });
  }

  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const ua = request.headers.get('user-agent') ?? '';
  const country = (request.headers.get('CF-IPCountry') ?? 'XX').toUpperCase().slice(0, 2);

  const visitor = toHex(await sha256(`${env.VISITOR_SALT}|${day}|${ip}|${ua}`)).slice(0, 32);

  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO visitors (day, visitor, country) VALUES (?, ?, ?)',
  )
    .bind(day, visitor, country)
    .run();

  const isNewToday = (inserted.meta?.changes ?? 0) > 0;
  const writes: D1PreparedStatement[] = [bump(env, 'pageviews')];
  if (isNewToday) {
    writes.push(bump(env, 'unique_visitors'));
    // T1 é a saída do Tor na classificação da Cloudflare; XX é desconhecido.
    if (country !== 'XX' && country !== 'T1') {
      writes.push(
        env.DB.prepare(
          `INSERT INTO countries (code, count) VALUES (?1, 1)
           ON CONFLICT(code) DO UPDATE SET count = count + 1`,
        ).bind(country),
      );
    }
  }
  await env.DB.batch(writes);

  return new Response(JSON.stringify(await readStats(env)), { headers });
}
