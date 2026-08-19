/**
 * Motor de simulação do algoritmo de Shor — matemática pura, zero DOM.
 *
 * Não simulamos porta a porta: o estado depois do oráculo é
 *     (1/√M) Σ_x |x⟩ |a^x mod N⟩
 * e os valores distintos do registrador de trabalho particionam os x em r
 * "pentes" aritméticos {x₀, x₀+r, x₀+2r, …}. A QFT⁻¹ de cada pente é uma
 * FFT de tamanho M — então o estado final exato sai em O(r·M·log M), o que
 * roda em milissegundos até N=63 (M=4096) num celular.
 *
 * Isso é uma simulação EXATA das amplitudes, não uma aproximação — a mesma
 * álgebra que um simulador porta a porta produziria, calculada pelo atalho
 * que a estrutura do circuito permite.
 */

export function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function modpow(base, exp, mod) {
  let r = 1n;
  let b = BigInt(base) % BigInt(mod);
  let e = BigInt(exp);
  const m = BigInt(mod);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return Number(r);
}

/** Ordem multiplicativa de a mod N (o "período" que o circuito estima). */
export function multiplicativeOrder(a, N) {
  let v = a % N;
  for (let r = 1; r <= N; r++) {
    if (v === 1) return r;
    v = (v * a) % N;
  }
  return 0; // gcd(a,N) != 1
}

/** N válido para a demonstração: ímpar, composto, não potência de primo.
 * Devolve null ou {code, p} — quem fala com humanos (e em que língua) é o
 * app.js, não a matemática. */
export function validateN(N) {
  if (!Number.isInteger(N) || N < 9) return { code: 'range' };
  if (N % 2 === 0) return { code: 'even' };
  for (let p = 3; p * p <= N; p += 2) {
    if (N % p === 0) {
      // Composto. Potência de primo? (Shor trata esse caso classicamente.)
      let q = N;
      while (q % p === 0) q /= p;
      if (q === 1) return { code: 'primepower', p };
      return null;
    }
  }
  return { code: 'prime' };
}

/** Bases coprimas com N, ordenadas pela ordem multiplicativa (didático). */
export function validBases(N) {
  const out = [];
  for (let a = 2; a < N; a++) {
    if (gcd(a, N) === 1) out.push({ a, r: multiplicativeOrder(a, N) });
  }
  return out.sort((x, y) => x.r - y.r || x.a - y.a);
}

/** Número de qubits de contagem do livro-texto: 2^m ≥ N². */
export function countingQubits(N) {
  return 2 * Math.ceil(Math.log2(N));
}

// ---------------------------------------------------------------------------
// FFT radix-2 in-place (tamanhos potência de 2)
// ---------------------------------------------------------------------------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// A simulação por etapas
// ---------------------------------------------------------------------------

/**
 * Prepara a instância: registradores, órbita de a, e os pentes.
 * Devolve tudo que as etapas seguintes precisam.
 */
export function prepare(N, a, m = countingQubits(N)) {
  const err = validateN(N);
  if (err) throw new Error(err);
  const g = gcd(a, N);
  if (g !== 1) {
    return { lucky: true, N, a, factor: g, other: N / g };
  }
  const M = 1 << m;
  const nWork = Math.ceil(Math.log2(N));
  const r = multiplicativeOrder(a, N);

  // Órbita: a^0, a^1, … a^(r-1) — os únicos valores que o trabalho assume.
  const orbit = [];
  let v = 1;
  for (let i = 0; i < r; i++) {
    orbit.push(v);
    v = (v * a) % N;
  }

  return { lucky: false, N, a, m, M, nWork, r, orbit, dim: 2 ** (m + nWork) };
}

/**
 * Etapa 3 (após a QFT⁻¹): distribuição exata da contagem e, por valor de
 * trabalho, as amplitudes complexas — para os gráficos de fase e o fasor.
 *
 * Devolve:
 *   probs      Float64Array(M): P(k) marginal
 *   perOrbit   [{w, re, im}] amplitudes da contagem condicionadas ao trabalho
 */
export function finalState(inst) {
  const { M, r, orbit } = inst;
  const probs = new Float64Array(M);
  const perOrbit = [];
  for (let s = 0; s < r; s++) {
    // Pente do resíduo s: x ∈ {s, s+r, s+2r, …} com amplitude 1/√M cada.
    const re = new Float64Array(M);
    const im = new Float64Array(M);
    const amp = 1 / Math.sqrt(M);
    for (let x = s; x < M; x += r) re[x] = amp;
    fft(re, im); // FFT direta == QFT⁻¹ do pente (convenção e^{-2πi kx/M})
    // Normalização da FFT -> QFT: dividir por √M.
    const norm = 1 / Math.sqrt(M);
    for (let k = 0; k < M; k++) {
      re[k] *= norm;
      im[k] *= norm;
      probs[k] += re[k] * re[k] + im[k] * im[k];
    }
    perOrbit.push({ w: orbit[s], re, im });
  }
  return { probs, perOrbit };
}

/**
 * Os fasores que se somam na amplitude ⟨k| do pente do resíduo s:
 * e^{-2πik(s+jr)/M} para j = 0 … Q-1. É a imagem da interferência:
 * em k ≈ múltiplos de M/r eles alinham; fora disso fecham o círculo.
 */
export function phasorsAt(inst, k, s = 0, cap = 96) {
  const { M, r } = inst;
  const Q = Math.ceil((M - s) / r);
  const n = Math.min(Q, cap);
  const out = [];
  for (let j = 0; j < n; j++) {
    out.push((-2 * Math.PI * k * (s + j * r)) / M % (2 * Math.PI));
  }
  return { angles: out, total: Q, shown: n };
}

/** Amostra k da distribuição (medição simulada). */
export function sampleK(probs, rand = Math.random) {
  let u = rand();
  for (let k = 0; k < probs.length; k++) {
    u -= probs[k];
    if (u <= 0) return k;
  }
  return probs.length - 1;
}

/**
 * Frações continuadas de k/M: a parte 100% clássica do pós-processamento.
 * Devolve os convergentes p/q com q < N e o veredito de cada um.
 */
export function continuedFractions(k, M, inst) {
  const steps = [];
  // Expansão de k/M: quocientes inteiros.
  const quots = [];
  let num = k, den = M;
  while (den > 0 && quots.length < 24) {
    quots.push(Math.floor(num / den));
    [num, den] = [den, num % den];
  }
  // Convergentes p/q.
  let p0 = 1, q0 = 0, p1 = quots[0], q1 = 1;
  const convs = [{ p: p1, q: q1 }];
  for (let i = 1; i < quots.length; i++) {
    const p2 = quots[i] * p1 + p0;
    const q2 = quots[i] * q1 + q0;
    convs.push({ p: p2, q: q2 });
    [p0, q0, p1, q1] = [p1, q1, p2, q2];
  }

  const { N, a } = inst;
  let found = null;
  for (const { p, q } of convs) {
    if (q >= N) { steps.push({ p, q, status: 'overflow' }); break; }
    if (q === 0) continue;
    const ok = modpow(a, q, N) === 1;
    steps.push({ p, q, status: ok ? 'period' : 'no' });
    if (ok && !found) { found = q; break; }
  }
  return { quotients: quots, steps, r: found };
}

/** Do período aos fatores — pode falhar; a falha é parte do algoritmo.
 * Falhas voltam como código ('no-period' | 'odd' | 'neg-one' | 'gcd'). */
export function factorsFromPeriod(inst, r) {
  const { N, a } = inst;
  if (!r) return { ok: false, code: 'no-period' };
  if (r % 2 === 1) return { ok: false, code: 'odd', r };
  const h = modpow(a, r / 2, N);
  if (h === N - 1) return { ok: false, code: 'neg-one', r };
  const f1 = gcd(h - 1, N);
  const f2 = gcd(h + 1, N);
  const f = f1 > 1 && f1 < N ? f1 : f2;
  if (f <= 1 || f >= N) return { ok: false, code: 'gcd', r };
  return { ok: true, f1: Math.min(f, N / f), f2: Math.max(f, N / f), half: h };
}

/** Ns de demonstração aceitos no seletor. */
export const PRESET_N = [15, 21, 33, 35, 39, 51, 55, 57];
