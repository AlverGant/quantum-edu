/**
 * Cliente da IBM Quantum via REST puro — sem Qiskit, sem SDK, só fetch().
 *
 * Adaptado do worker do sorteio-quantico. A diferença de filosofia: lá o
 * Worker *constrói* o circuito (H em tudo, sem transpilação); aqui ele só
 * *entrega* QASM3 pré-transpilado offline por circuits/build_circuits.py.
 * Os circuitos de Shor emaranham e exigem roteamento de verdade — coisa de
 * transpilador, não de Worker.
 */

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const API = 'https://quantum.cloud.ibm.com/api/v1';
// A API da IBM fica atrás de CDN e recusa clientes sem User-Agent com 403.
const UA = 'quantum-edu-worker/1.0 (+https://quantum.vynstream.com)';

export interface IbmAuth {
  apiKey: string;
  crn: string;
}

async function iamToken(apiKey: string): Promise<string> {
  const res = await fetch(IAM_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: apiKey,
    }),
  });
  if (!res.ok) throw new Error(`IAM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('IAM não devolveu access_token');
  return body.access_token;
}

/** Sessão autenticada. O token IAM vale 1h — mais que suficiente por invocação. */
export class IbmClient {
  private token: string | null = null;
  private readonly auth: IbmAuth;

  constructor(auth: IbmAuth) {
    this.auth = auth;
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token) this.token = await iamToken(this.auth.apiKey);
    return {
      authorization: `Bearer ${this.token}`,
      'Service-CRN': this.auth.crn,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': UA,
    };
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(API + path, { ...init, headers: await this.headers() });
    if (!res.ok) {
      throw new Error(`IBM ${init.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async status(name: string): Promise<{ status: string; length_queue: number }> {
    return this.call(`/backends/${encodeURIComponent(name)}/status`);
  }

  /**
   * Submete um job com um ou mais circuitos.
   *
   * Os três circuitos viajam como PUBs no MESMO job: o custo por job tem um
   * componente fixo de ~3 s de QPU cobrada, então três jobs separados
   * pagariam esse pedágio três vezes.
   */
  async submitSampler(backend: string, pubs: PubSpec[]): Promise<string> {
    if (pubs.length === 0) throw new Error('submissão sem nenhum circuito');
    const job = await this.call<{ id?: string }>('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        program_id: 'sampler',
        backend,
        params: {
          pubs: pubs.map((p) => [p.qasm, null, p.shots]),
          version: 2,
          support_qiskit: false,
        },
      }),
    });
    if (!job.id) throw new Error('submissão não devolveu id de job');
    return job.id;
  }

  async job(id: string): Promise<{ status: string; reason: string | null; charged: number | null }> {
    const j = await this.call<{
      state?: { status?: string; reason?: string };
      bss?: { seconds?: number };
    }>(`/jobs/${encodeURIComponent(id)}`);
    return {
      status: j.state?.status ?? 'Unknown',
      reason: j.state?.reason ?? null,
      charged: j.bss?.seconds ?? null,
    };
  }

  /** Amostras hex de cada PUB, na mesma ordem em que foram submetidos. */
  async results(id: string): Promise<string[][]> {
    const r = await this.call<{
      results?: Array<{ data?: Record<string, { samples?: string[] }> }>;
    }>(`/jobs/${encodeURIComponent(id)}/results`);
    const entries = r.results;
    if (!entries?.length) throw new Error('resultado sem campo results');
    return entries.map((entry, i) => {
      const data = entry.data;
      if (!data) throw new Error(`resultado ${i} sem campo data`);
      // O registrador se chama "meas" no QASM gerado; aceitamos qualquer
      // nome para não quebrar se a API mudar o rótulo.
      const reg = data.meas ?? Object.values(data)[0];
      if (!reg?.samples) throw new Error(`resultado ${i} sem amostras`);
      return reg.samples;
    });
  }
}

export interface PubSpec {
  qasm: string;
  shots: number;
}
