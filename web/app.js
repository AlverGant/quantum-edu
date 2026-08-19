/**
 * Cola da página: widgets dos capítulos, o passo-a-passo do algoritmo e a
 * seção de hardware real. Toda a matemática vive em sim.js; todo o desenho
 * em viz.js. Aqui é só estado de interface.
 */

import {
  prepare, finalState, sampleK, continuedFractions,
  factorsFromPeriod, validateN, validBases, modpow, gcd, PRESET_N,
} from './sim.js';
import { drawHistogram, circuitSVG, SERIES } from './viz.js';

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
const fmtBig = (n) => (1n << BigInt(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Probabilidade para humanos: "25%", "1,6%", "<0,01%" — nunca "2.5e-1". */
const fmtP = (p) => {
  if (p <= 0) return '0%';
  if (p < 0.0001) return '<0,01%';
  const v = p * 100;
  const dec = v >= 10 ? 0 : v >= 1 ? 1 : 2;
  return v.toFixed(dec).replace('.', ',') + '%';
};

// ---------------------------------------------------------------------------
// Infra de gráficos: registro para redesenho em resize + tooltip único
// ---------------------------------------------------------------------------

const charts = new Map(); // canvas -> {draw, tip}
const tooltip = $('tooltip');

function chart(canvas, draw, tip) {
  charts.set(canvas, { draw, tip, hit: null });
  redraw(canvas);
  if (tip && !canvas.dataset.tipBound) {
    canvas.dataset.tipBound = '1';
    canvas.addEventListener('pointermove', (ev) => {
      const c = charts.get(canvas);
      const i = c?.hit?.hitTest(ev.clientX, ev.clientY) ?? -1;
      const html = i >= 0 ? c.tip(i) : null;
      if (!html) { tooltip.classList.add('hidden'); return; }
      tooltip.innerHTML = html;
      tooltip.classList.remove('hidden');
      const pad = 14;
      const tw = tooltip.offsetWidth;
      let x = ev.clientX + pad;
      if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - pad;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${ev.clientY + pad}px`;
    });
    canvas.addEventListener('pointerleave', () => tooltip.classList.add('hidden'));
  }
}

function redraw(canvas) {
  const c = charts.get(canvas);
  if (c) c.hit = c.draw(canvas);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { for (const cv of charts.keys()) redraw(cv); }, 150);
});

function legendHTML(items) {
  return items.map(([kind, color, label]) => {
    const sw = kind === 'bar'
      ? `<span class="sw sw-bar" style="background:${color}"></span>`
      : kind === 'dash'
        ? `<span class="sw sw-dash" style="background:${color}"></span>`
        : `<span class="sw sw-dot" style="border-color:${color}"></span>`;
    return `<span class="lg-item">${sw}${label}</span>`;
  }).join('');
}

function tableHTML(rows, headers) {
  const h = headers.map((x) => `<th>${x}</th>`).join('');
  const b = rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');
  return `<table class="data-tbl"><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Capítulo 1 — o qubit e o H duplo
// ---------------------------------------------------------------------------

const qubit = { re: [1, 0], im: [0, 0], hops: 0 };

function qubitDraw() {
  const mags = qubit.re.map((r, i) => Math.hypot(r, qubit.im[i]));
  const phases = qubit.re.map((r, i) => Math.atan2(qubit.im[i], r));
  chart($('q-canvas'),
    (cv) => drawHistogram(cv, { values: mags, phases, labels: ['|0⟩', '|1⟩'], maxY: 1.1 }),
    (i) => `|${i}⟩ &nbsp; amplitude ${mags[i].toFixed(3)} &nbsp; fase ${phases[i].toFixed(2)} rad<br>probabilidade ${(mags[i] ** 2 * 100).toFixed(1)}%`);
  const states = ['|0⟩', '(|0⟩ + |1⟩)/√2 — os dois ao mesmo tempo'];
  $('q-state').textContent = states[qubit.hops % 2];
  $('q-caption').textContent = qubit.hops % 2 === 1
    ? 'Depois de um H: duas setas de mesmo tamanho — 50% para cada lado se você medir agora.'
    : qubit.hops === 0
      ? 'Amplitudes do qubit — altura = |amplitude|, cor = fase.'
      : 'H de novo: o caminho até |1⟩ veio duas vezes com sinais opostos e se cancelou. De volta a |0⟩ — determinístico.';
}

$('q-h').addEventListener('click', () => {
  const [r0, r1] = qubit.re;
  const [i0, i1] = qubit.im;
  const s = Math.SQRT1_2;
  qubit.re = [(r0 + r1) * s, (r0 - r1) * s];
  qubit.im = [(i0 + i1) * s, (i0 - i1) * s];
  qubit.hops++;
  qubitDraw();
});
$('q-reset').addEventListener('click', () => {
  qubit.re = [1, 0]; qubit.im = [0, 0]; qubit.hops = 0;
  qubitDraw();
});
qubitDraw();

// ---------------------------------------------------------------------------
// Capítulo 2 — espaço de Hilbert
// ---------------------------------------------------------------------------

const HILBERT_MARKS = [
  [10, 'mais de mil dimensões'],
  [20, 'mais de um milhão'],
  [30, 'mais de um bilhão'],
  [33, 'mais dimensões que pessoas na Terra'],
  [38, 'mais que estrelas na Via Láctea'],
  [50, 'mais que todas as páginas web indexadas'],
  [60, 'quase tantas quanto grãos de areia em todas as praias do planeta'],
];

function hilbertDraw() {
  const n = Number($('hilbert-n').value);
  let note = '';
  for (const [lim, txt] of HILBERT_MARKS) if (n >= lim) note = txt;
  $('hilbert-read').innerHTML =
    `<b>${n}</b> qubit${n > 1 ? 's' : ''} → <b>2<sup>${n}</sup> = ${fmtBig(n)}</b> dimensões` +
    (note ? `<br><span class="dim-note">${note}</span>` : '');
  chart($('hilbert-canvas'), (cv) => {
    const w = cv.getBoundingClientRect().width - 52;
    const total = n <= 30 ? 2 ** n : Infinity;
    const shown = Math.min(total, Math.max(2, Math.floor(w)));
    const values = new Float64Array(shown).fill(1);
    return drawHistogram(cv, {
      values, maxY: 1.3,
      labels: Array.from({ length: shown }, (_, i) => (i === 0 ? '0' : '')),
    });
  }, null);
}
$('hilbert-n').addEventListener('input', hilbertDraw);
hilbertDraw();

// ---------------------------------------------------------------------------
// Capítulo 3 — período de 7^x mod 15
// ---------------------------------------------------------------------------

{
  const xs = 16;
  const vals = Array.from({ length: xs }, (_, x) => modpow(7, x, 15));
  chart($('per-canvas'),
    (cv) => drawHistogram(cv, {
      values: vals, maxY: 15,
      labels: Array.from({ length: xs }, (_, x) => x),
    }),
    (i) => `7<sup>${i}</sup> mod 15 = <b>${vals[i]}</b>`);
}

// ---------------------------------------------------------------------------
// Capítulo 4 — o simulador: um clique, medições automáticas, resultado
// ---------------------------------------------------------------------------

for (const n of PRESET_N) {
  const b = document.createElement('button');
  b.className = 'btn tiny ghost';
  b.textContent = n;
  b.addEventListener('click', () => { $('sim-n').value = String(n); refreshBases(); });
  $('sim-presets').appendChild(b);
}

/** Base "boa": período par com a^(r/2) != -1 — as outras nunca fatoram. */
function baseWorks(N, a, r) {
  return factorsFromPeriod({ N, a }, r).ok;
}

function refreshBases() {
  const N = Number($('sim-n').value);
  const err = validateN(N);
  $('sim-err').textContent = err ?? '';
  const sel = $('sim-a');
  sel.replaceChildren();
  if (err) return;
  const bases = validBases(N);
  for (const { a, r } of bases) {
    const o = document.createElement('option');
    o.value = String(a);
    o.textContent = baseWorks(N, a, r) ? `a = ${a}` : `a = ${a} (base ruim)`;
    sel.appendChild(o);
  }
  // Padrão: o clássico a=7 para 15; senão uma base que funciona.
  const works = bases.filter((b) => baseWorks(N, b.a, b.r));
  const prefer = N === 15 && works.some((b) => b.a === 7)
    ? 7 : works[Math.floor(works.length / 2)]?.a;
  if (prefer != null) sel.value = String(prefer);
}
$('sim-n').addEventListener('input', refreshBases);
refreshBases();

let simFirstRun = true;

function runShor() {
  const N = Number($('sim-n').value);
  const err = validateN(N);
  if (err) { $('sim-err').textContent = err; return; }
  const a = Number($('sim-a').value);
  const inst = prepare(N, a);
  const fs = finalState(inst);
  const { good, f1, f2 } = goodShots(N, a, inst.M);

  $('sim-body').classList.remove('hidden');
  $('sim-regs').innerHTML =
    `${inst.m} qubits de contagem + ${inst.nWork} de trabalho — seu navegador acabou de calcular ` +
    `exatamente as <b>2<sup>${inst.m + inst.nWork}</sup> = ${fmt(inst.dim)} dimensões</b> deste espaço de Hilbert`;
  circuitSVG($('sim-circuit'), inst);

  // O gráfico: o que o computador quântico devolve.
  const drawDist = (winK) => {
    $('sim-legend').innerHTML = legendHTML([
      ['bar', SERIES.measured, 'chance de cada k sair na medição'],
      ...(winK != null ? [['dash', SERIES.accent, `k = ${winK} — a medição que fatorou`]] : []),
    ]);
    chart($('sim-canvas'), (c) => drawHistogram(c, {
      values: fs.probs, percent: true, uniform: true,
      highlight: winK ?? null,
    }), (k) => `k = ${k}<br>chance: ${fmtP(fs.probs[k])}<br>${good.has(k) ? '✓ este k entrega os fatores' : '— este k não fatora sozinho'}`);
    const top = [...fs.probs].map((p, k) => [k, p]).sort((x, y) => y[1] - x[1])
      .slice(0, 24).sort((x, y) => x[0] - y[0]);
    $('sim-table').innerHTML = tableHTML(
      top.map(([k, p]) => [k, fmtP(p), good.has(k) ? `✓ leva a ${f1} × ${f2}` : '—']),
      ['k', 'chance', 'fatora?']);
  };

  // Base que nunca fatora: diz na cara, sem fingir que mede.
  if (good.size === 0) {
    drawDist(null);
    const why = factorsFromPeriod(inst, inst.r).why;
    $('sim-result').innerHTML = `
      <div class="verdict verdict-bad">
        <div class="v-big">essa base nunca fatora ✗</div>
        <div class="v-sub">${why}. No Shor real isso acontece com parte das
        bases — sorteia-se outra e pronto. Troque o <b>a</b> acima e rode de novo.</div>
      </div>`;
    return;
  }

  // Mede sozinho até cair num k bom (30 é teto de segurança).
  const attempts = [];
  let win = null;
  for (let t = 0; t < 30 && win == null; t++) {
    const k = sampleK(fs.probs);
    attempts.push(k);
    if (good.has(k)) win = k;
  }
  drawDist(win);

  if (win == null) {
    $('sim-result').innerHTML = `
      <div class="verdict verdict-bad">
        <div class="v-big">azar estatístico raríssimo ✗</div>
        <div class="v-sub">30 medições sem um k bom — rode de novo.</div>
      </div>
      <p class="controls"><button id="sim-rerun" class="btn small ghost">rodar de novo</button></p>`;
    $('sim-rerun').addEventListener('click', runShor);
    return;
  }

  const tries = attempts.length;
  const cf = continuedFractions(win, inst.M, inst);
  const hi = halfInfo(N, a, cf.r);
  const pGood = [...good].reduce((s, k) => s + fs.probs[k], 0);
  const s0 = Math.round((win * cf.r) / inst.M);
  $('sim-result').innerHTML = `
    <div class="verdict verdict-ok">
      <div class="v-big">${N} = ${f1} × ${f2}</div>
      <div class="v-sub">✓ ${tries === 1
        ? 'fatorado na primeira medição'
        : `fatorado na ${tries}ª medição (saíram k = ${attempts.join(', ')})`}
        — k = ${win} revelou o período r = ${cf.r}, e dois mdc fecharam a conta</div>
    </div>
    <details class="how"><summary>ver a conta: de k = ${win} aos fatores ${f1} × ${f2}</summary>
      <p class="fine">A medição deu k = ${win}, ou seja, k/M = ${win}/${inst.M} ≈ ${s0}/${cf.r}.
      As frações continuadas acham essa fração simples, e o denominador é o período:</p>
      ${tableHTML(cf.steps.map(({ p, q, verdict }) => [`${p}/${q}`, verdict]),
        ['convergente p/q', 'q é o período?'])}
      <p class="fine">Com r = ${cf.r}: ${hi.expr}, e mdc(${hi.half} − 1, ${N}) e
      mdc(${hi.half} + 1, ${N}) dão <b>${f1}</b> e <b>${f2}</b>. A conta final é 100%
      clássica — o quantum serviu só para achar o período.</p>
      ${tries > 1 ? `<p class="fine">As medições anteriores caíram em k que não fatora
      sozinho (k = 0 não diz nada; outros simplificam para a fração errada) — normal:
      aqui ${fmtP(pGood)} das medições servem, e basta uma.</p>` : ''}
    </details>
    <p class="controls"><button id="sim-rerun" class="btn small ghost">rodar de novo</button></p>`;
  $('sim-rerun').addEventListener('click', runShor);

  if (simFirstRun) {
    simFirstRun = false;
    $('sim-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
$('sim-go').addEventListener('click', runShor);

// ---------------------------------------------------------------------------
// Capítulo 5 — hardware real
// ---------------------------------------------------------------------------

/**
 * Quais k's levam sozinhos aos fatores de N (frações continuadas + mdc)?
 * Para r ímpar com a = b² usamos √(a^r) = b^r — o truque das demonstrações
 * clássicas de N=21 com a=4. Devolve o conjunto e os fatores.
 */
function goodShots(N, a, M) {
  const inst = { N, a };
  const good = new Set();
  let f1 = null, f2 = null;
  for (let k = 0; k < M; k++) {
    const r = continuedFractions(k, M, inst).r;
    if (!r) continue;
    if (r % 2 === 0) {
      const fr = factorsFromPeriod(inst, r);
      if (fr.ok) { good.add(k); f1 = fr.f1; f2 = fr.f2; }
    } else {
      const b = Math.round(Math.sqrt(a));
      if (b * b === a) {
        const h = modpow(b, r, N);
        const g1 = gcd(h - 1, N), g2 = gcd(h + 1, N);
        const g = g1 > 1 && g1 < N ? g1 : g2;
        if (g > 1 && g < N) { good.add(k); f1 = Math.min(g, N / g); f2 = Math.max(g, N / g); }
      }
    }
  }
  return { good, f1, f2 };
}

/** A "raiz quadrada útil" de a^r mod N — com o truque b^r quando r é ímpar
 * e a = b² (o caso clássico de N=21 com a=4). */
function halfInfo(N, a, r) {
  if (r % 2 === 0) {
    const half = modpow(a, r / 2, N);
    return { half, expr: `${a}<sup>${r / 2}</sup> mod ${N} = ${half}` };
  }
  const b = Math.round(Math.sqrt(a));
  const half = modpow(b, r, N);
  return { half, expr: `${a} = ${b}², então √(${a}<sup>${r}</sup>) = ${b}<sup>${r}</sup> mod ${N} = ${half}` };
}

/** O parágrafo que faltava nos cards: por que ESTES picos viram os fatores. */
function explainPeaks(c, M, good, f1, f2, drowned = false) {
  const { N, a, r } = c;
  const peaks = [...new Set(Array.from({ length: r }, (_, s) => Math.round((s * M) / r) % M))]
    .sort((x, y) => x - y);
  const stepStr = Number.isInteger(M / r) ? String(M / r) : `${M}/${r} ≈ ${(M / r).toFixed(2)}`;
  const g0 = Math.min(...good);
  const s0 = Math.round((g0 * r) / M);
  const hi = halfInfo(N, a, r);
  const bads = peaks.filter((k) => !good.has(k));
  const opening = drowned
    ? `sem ruído, o circuito devolveria um k perto de múltiplo de ${stepStr} — os
       traços violeta em k = ${peaks.join(', ')} mostram onde os picos deveriam estar`
    : `o circuito devolve um k perto de múltiplo de ${stepStr} — por isso os picos
       em k = ${peaks.join(', ')}`;
  return `<p class="fine hw-why"><b>${drowned ? 'Como o gráfico DEVERIA virar fatores' : 'Do gráfico aos fatores'}:</b>
    ${opening}. Um k bom vira fração e entrega o período: k = ${g0} → ${g0}/${M} ≈ ${s0}/${r},
    e o denominador é o período <b>r = ${r}</b>. Do período aos fatores:
    ${hi.expr}, e mdc(${hi.half} − 1, ${N}) e mdc(${hi.half} + 1, ${N}) dão
    <b>${f1}</b> e <b>${f2}</b>. Já ${bads.length > 1 ? `os picos k = ${bads.join(' e k = ')} não servem sozinhos` : `o pico k = ${bads[0]} não serve sozinho`}
    (0 não diz nada; os outros simplificam para uma fração de denominador errado) —
    por isso se mede mais de uma vez e basta UMA medição boa.</p>`;
}

async function loadHardware() {
  let meta = null;
  try {
    meta = await (await fetch('data/circuits.json')).json();
  } catch {
    $('hw-status').textContent = 'não consegui carregar os metadados dos circuitos.';
    return;
  }

  let run = null;
  try {
    // no-cache: revalida sempre — sem isso, quem visitou antes da primeira
    // rodada ficava vendo "sem rodada" até o max-age do navegador expirar.
    const r = await (await fetch('/api/runs', { cache: 'no-cache' })).json();
    run = r.run;
  } catch { /* preview local sem Worker: segue sem dados reais */ }

  $('hw-status').innerHTML = run
    ? `última rodada: <b>${run.backend}</b> · job <span class="mono">${run.job_id}</span> · ${run.completed_at} UTC` +
      (run.charged_seconds ? ` · ${run.charged_seconds}s de QPU cobrados` : '')
    : 'ainda sem rodada no hardware — mostrando as distribuições ideais de cada circuito.';

  const byId = Object.fromEntries((run?.results ?? []).map((x) => [x.id, x]));
  const cards = $('hw-cards');
  cards.replaceChildren();

  for (const c of meta) {
    const backend = run?.backend && c.backends[run.backend] ? run.backend : Object.keys(c.backends)[0];
    const st = c.backends[backend];
    const M = 2 ** c.counting_qubits;
    const res = byId[c.id];

    const card = document.createElement('div');
    card.className = 'panel hw-card';
    card.innerHTML = `
      <div class="hw-head">
        <h3>${c.title}</h3>
        <span class="chip ${c.kind === 'generico' ? 'chip-warn' : ''}">${c.kind}</span>
      </div>
      <p class="fine">${c.note}</p>
      <p class="hw-stats mono">N=${c.N} · a=${c.a} · ${c.logical_qubits} qubits ·
        profundidade ${fmt(st.depth)} · <b>${fmt(st.twoq_gates)} portas de 2 qubits</b> ·
        ${fmt(c.shots)} shots</p>
      <div class="legend">${legendHTML([
        ...(res ? [['bar', SERIES.measured, 'medido na QPU']] : []),
        ['dash', SERIES.ideal, 'ideal (sem ruído)'],
        ['dash', SERIES.axis, 'uniforme = ruído puro'],
      ])}</div>
      <canvas class="viz" height="200"></canvas>
      <div class="hw-concl"></div>
      <details class="tbl-details"><summary>ver como tabela</summary><div class="hw-tbl"></div></details>`;
    cards.appendChild(card);

    const cv = card.querySelector('canvas');
    const values = new Float64Array(M);
    if (res) {
      for (const [k, n] of Object.entries(res.counts)) values[Number(k)] = n / res.shots;
    }
    const idealNum = Object.fromEntries(Object.entries(c.ideal).map(([k, v]) => [k, v]));
    chart(cv, (canvas) => drawHistogram(canvas, {
      values: res ? values : new Float64Array(M),
      ideal: idealNum,
      uniform: true, percent: true,
    }), (k) => {
      const parts = [`k = ${k}`];
      if (res) parts.push(`medido: ${((values[k] ?? 0) * 100).toFixed(1)}% (${res.counts[k] ?? 0}/${res.shots})`);
      parts.push(`ideal: ${((idealNum[k] ?? 0) * 100).toFixed(1)}%`);
      return parts.join('<br>');
    });

    // A conclusão que fecha o círculo: destes shots, quantos fatoram N?
    const { good, f1, f2 } = goodShots(c.N, c.a, M);
    const chance = good.size / M;
    const concl = card.querySelector('.hw-concl');
    let drowned = false;
    if (res) {
      let hit = 0;
      for (const [k, n] of Object.entries(res.counts)) if (good.has(Number(k))) hit += n;
      const frac = hit / res.shots;
      drowned = frac <= chance * 1.5;
      if (!drowned) {
        concl.innerHTML = `<div class="hw-verdict ok"><b>→ ${c.N} = ${f1} × ${f2}</b>
          <span>${fmt(hit)} dos ${fmt(res.shots)} shots (${fmtP(frac)}) caíram num k que,
          sozinho, entrega os fatores via frações continuadas + mdc — um chute cego
          acertaria ${fmtP(chance)}. Basta UMA medição boa, e aqui quase metade serve.</span></div>`;
      } else {
        concl.innerHTML = `<div class="hw-verdict bad"><b>→ os fatores NÃO saem daqui</b>
          <span>só ${fmtP(frac)} dos shots caíram em k "bom" — praticamente igual ao
          chute cego (${fmtP(chance)}). O circuito afogou no ruído antes de computar:
          este histograma não sabe que ${c.N} = ${f1} × ${f2}.</span></div>`;
      }
    } else {
      const idealHit = [...good].reduce((s, k) => s + (idealNum[k] ?? 0), 0);
      concl.innerHTML = `<p class="fine">no ideal, ${fmtP(idealHit)} das medições
        levariam direto aos fatores ${f1} × ${f2}.</p>`;
    }
    concl.innerHTML += explainPeaks(c, M, good, f1, f2, drowned);

    const rows = [];
    for (let k = 0; k < M; k++) {
      const mv = res ? (values[k] ?? 0) : null;
      const iv = idealNum[k] ?? 0;
      if ((mv ?? 0) > 0 || iv > 0) {
        rows.push([k, mv != null ? (mv * 100).toFixed(2) + '%' : '—', (iv * 100).toFixed(2) + '%',
          good.has(k) ? `✓ leva a ${f1} × ${f2}` : '—']);
      }
    }
    card.querySelector('.hw-tbl').innerHTML = tableHTML(rows, ['k', 'medido', 'ideal', 'fatora?']);
  }
}
loadHardware();
