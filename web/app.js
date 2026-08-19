/**
 * Cola da página: widgets dos capítulos, o passo-a-passo do algoritmo e a
 * seção de hardware real. Toda a matemática vive em sim.js; todo o desenho
 * em viz.js. Aqui é só estado de interface.
 */

import {
  prepare, finalState, phasorsAt, sampleK, continuedFractions,
  factorsFromPeriod, validateN, validBases, countingQubits, modpow, PRESET_N,
} from './sim.js';
import {
  drawHistogram, drawPhasorSum, circuitSVG, SERIES, phaseColor,
} from './viz.js';

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
const fmtBig = (n) => (1n << BigInt(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

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
// Capítulo 3 — interferência
// ---------------------------------------------------------------------------

const INT_N = 24;

function interferenceDraw() {
  const v = Number($('int-slider').value);
  const delta = (v / 200) * (Math.PI / 3);
  const angles = Array.from({ length: INT_N }, (_, j) => j * delta);
  chart($('int-canvas'), (cv) => {
    drawPhasorSum(cv, angles);
    return null;
  }, null);
}
$('int-slider').addEventListener('input', interferenceDraw);
$('int-c').addEventListener('click', () => { $('int-slider').value = '0'; interferenceDraw(); });
$('int-d').addEventListener('click', () => {
  // Uma volta completa dividida entre as 24 setas: soma exatamente zero.
  $('int-slider').value = String(Math.round((2 * Math.PI / INT_N) / (Math.PI / 3) * 200));
  interferenceDraw();
});
interferenceDraw();

// ---------------------------------------------------------------------------
// Capítulo 4 — período de 7^x mod 15
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
// Capítulo 5 — o simulador
// ---------------------------------------------------------------------------

const sim = {
  inst: null, fs: null, stage: 0, orbitSel: null,
  measured: null, attempts: 0, circuit: null,
};

// Presets
for (const n of PRESET_N) {
  const b = document.createElement('button');
  b.className = 'btn tiny ghost';
  b.textContent = n;
  b.addEventListener('click', () => { $('sim-n').value = String(n); refreshBases(); });
  $('sim-presets').appendChild(b);
}

function refreshBases() {
  const N = Number($('sim-n').value);
  const err = validateN(N);
  $('sim-err').textContent = err ?? '';
  const sel = $('sim-a');
  sel.replaceChildren();
  if (err) return;
  for (const { a } of validBases(N)) {
    const o = document.createElement('option');
    o.value = String(a);
    o.textContent = `a = ${a}`;
    sel.appendChild(o);
  }
  // Padrão didático: a=7 para 15 (o clássico); senão uma base qualquer.
  const prefer = N === 15 ? '7' : sel.options[Math.floor(sel.options.length / 2)]?.value;
  if (prefer) sel.value = prefer;
}
$('sim-n').addEventListener('input', refreshBases);
refreshBases();

$('sim-go').addEventListener('click', () => {
  const N = Number($('sim-n').value);
  const err = validateN(N);
  if (err) { $('sim-err').textContent = err; return; }
  const a = Number($('sim-a').value);
  const inst = prepare(N, a);
  sim.inst = inst;
  sim.fs = finalState(inst);
  sim.stage = 0;
  sim.orbitSel = null;
  sim.measured = null;
  sim.attempts = 0;
  $('sim-body').classList.remove('hidden');
  $('sim-regs').innerHTML =
    `registrador de contagem: <b>${inst.m} qubits</b> (M = 2<sup>${inst.m}</sup> = ${fmt(inst.M)} valores) · ` +
    `trabalho: <b>${inst.nWork} qubits</b> · espaço de Hilbert: <b>2<sup>${inst.m + inst.nWork}</sup> = ${fmt(inst.dim)} dimensões</b>, ` +
    `calculadas exatamente aqui no seu navegador`;
  sim.circuit = circuitSVG($('sim-circuit'), inst);
  const slider = $('sim-k');
  slider.max = String(inst.M - 1);
  slider.value = String(Math.round(inst.M / inst.r));
  showStage(0);
  $('sim-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const STAGE_TEXT = [
  (i) => `<p><b>H em cada qubit de contagem.</b> O registrador vira a soma de
    <b>todos os ${fmt(i.M)} valores de x ao mesmo tempo</b>, cada um com
    amplitude 1/√M — as ${fmt(i.M)} barrinhas iguais aí embaixo, todas com a
    mesma fase. Ainda não há nada de útil aqui: uma medição agora devolveria
    um x aleatório, como jogar dados.</p>`,
  (i) => `<p><b>O oráculo calcula a<sup>x</sup> mod N uma única vez</b> — sobre a
    superposição inteira. Os dois registradores ficam <b>emaranhados</b>: cada
    valor do trabalho carrega consigo o conjunto de x's que o produz. Como
    ${i.a}<sup>x</sup> mod ${i.N} só assume <b>r = ${i.r} valores</b> (a órbita
    ${i.orbit.slice(0, 6).join(', ')}${i.r > 6 ? ', …' : ''}), o trabalho é um
    histograma de ${i.r} barras — e <b>clicando numa barra</b> você vê o pente
    de x's amarrado àquele valor: x₀, x₀+r, x₀+2r, … O período já está inscrito
    no estado; falta arrancá-lo de lá.</p>`,
  (i) => `<p><b>A QFT⁻¹ é a máquina de interferência.</b> Cada pente interfere
    consigo mesmo: nos k próximos de <b>múltiplos de M/r = ${(i.M / i.r).toFixed(1)}</b>
    as setas chegam alinhadas (construtiva) e a probabilidade se concentra;
    em todos os outros k elas fecham o círculo e <b>se cancelam</b>. Use o
    slider para inspecionar qualquer k: o desenho ao lado é a soma real das
    setas desse k.</p>`,
  (i) => `<p><b>A medição colapsa o registrador</b> num único k — sorteado pela
    distribuição que a interferência esculpiu. De k/M, as <b>frações
    continuadas</b> (pós-processamento 100% clássico) recuperam o período r;
    com r, dois mdc entregam os fatores. O algoritmo é probabilístico: medições
    "ruins" (k=0, convergente errado, r ímpar) fazem parte — meça de novo e
    conte quantas tentativas precisou.</p>`,
];

function showStage(s) {
  sim.stage = s;
  const i = sim.inst;
  document.querySelectorAll('.step-btn').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.step) === s));
  $('sim-text').innerHTML = STAGE_TEXT[s](i);
  sim.circuit.highlightStage(s);
  $('sim-phasor-box').classList.toggle('hidden', s !== 2);
  $('sim-measure-box').classList.toggle('hidden', s !== 3);
  $('sim-prev').disabled = s === 0;
  $('sim-next').disabled = s === 3;
  drawStageChart();
  if (s === 2) drawPhasor();
}

function drawStageChart() {
  const i = sim.inst;
  const cv = $('sim-canvas');
  const s = sim.stage;

  if (s === 0) {
    $('sim-legend').innerHTML = legendHTML([
      ['bar', SERIES.measured, `amplitude de cada x (todas iguais, fase 0) — eixo y: probabilidade`],
    ]);
    const values = new Float64Array(i.M).fill(1 / i.M);
    const phases = new Float64Array(i.M);
    chart(cv, (c) => drawHistogram(c, { values, phases }),
      (k) => `x = ${k}<br>P = 1/M = ${(1 / i.M).toExponential(2)}`);
    fillTable(Array.from({ length: Math.min(i.M, 64) }, (_, k) => [k, (1 / i.M).toExponential(3)]),
      ['x', 'probabilidade'], i.M > 64 ? `mostrando 64 de ${fmt(i.M)} linhas — todas iguais` : '');
    return;
  }

  if (s === 1) {
    if (sim.orbitSel == null) {
      $('sim-legend').innerHTML = legendHTML([
        ['bar', SERIES.measured, `probabilidade de cada valor do trabalho (clique para ver o pente)`],
      ]);
      const values = new Float64Array(i.r).fill(1 / i.r);
      chart(cv, (c) => drawHistogram(c, { values, labels: i.orbit, maxY: Math.min(1, 1.6 / i.r) }),
        (b) => `trabalho = ${i.orbit[b]} = ${i.a}<sup>${b}</sup> mod ${i.N}<br>P = 1/r = ${(1 / i.r).toFixed(3)}<br><i>clique para ver o pente de x's</i>`);
      cv.onclick = (ev) => {
        const h = charts.get(cv)?.hit;
        const b = h?.hitTest(ev.clientX, ev.clientY) ?? -1;
        if (b >= 0) { sim.orbitSel = b; drawStageChart(); }
      };
      fillTable(i.orbit.map((w, b) => [`${i.a}<sup>${b}</sup> mod ${i.N}`, w, (1 / i.r).toFixed(4)]),
        ['origem', 'valor do trabalho', 'probabilidade'], '');
    } else {
      const sRes = sim.orbitSel;
      $('sim-legend').innerHTML = legendHTML([
        ['bar', SERIES.measured, `os x's com ${i.a}<sup>x</sup> ≡ ${i.orbit[sRes]}: x = ${sRes}, ${sRes + i.r}, ${sRes + 2 * i.r}, … (passo r = ${i.r})`],
      ]) + ` <button class="btn tiny ghost" id="sim-back-orbit">← voltar à órbita</button>`;
      const values = new Float64Array(i.M);
      for (let x = sRes; x < i.M; x += i.r) values[x] = 1 / i.M;
      chart(cv, (c) => drawHistogram(c, { values }),
        (x) => values[x] > 0
          ? `x = ${x} ✓ (${i.a}<sup>${x}</sup> ≡ ${i.orbit[sRes]} mod ${i.N})`
          : `x = ${x} — fora deste pente`);
      $('sim-back-orbit').addEventListener('click', () => { sim.orbitSel = null; drawStageChart(); });
      cv.onclick = null;
      fillTable([], [], 'o pente é a figura — a tabela seria só a P.A. acima');
    }
    return;
  }

  cv.onclick = null;

  // Etapas 2 e 3: distribuição final da contagem.
  const probs = sim.fs.probs;
  const ideal = null;
  const legend = [
    ['bar', SERIES.measured, 'P(k) — probabilidade de medir cada k'],
  ];
  if (sim.stage === 3 && sim.measured != null) {
    legend.push(['dash', SERIES.accent, `k medido = ${sim.measured}`]);
  }
  $('sim-legend').innerHTML = legendHTML(legend);
  chart(cv, (c) => drawHistogram(c, {
    values: probs, ideal,
    highlight: sim.stage === 3 ? sim.measured : null,
    uniform: true,
  }), (k) => {
    const p = probs[k];
    const near = Math.round((k * i.r) / i.M);
    return `k = ${k}<br>P(k) = ${p.toExponential(3)}<br>k·r/M ≈ ${((k * i.r) / i.M).toFixed(2)} ${p > 1 / i.M ? `→ perto de ${near}` : ''}`;
  });
  const top = [...probs].map((p, k) => [k, p]).sort((a, b) => b[1] - a[1]).slice(0, 24)
    .sort((a, b) => a[0] - b[0]);
  fillTable(top.map(([k, p]) => [k, p.toFixed(5), `${(k / i.M).toFixed(4)} ≈ s/r`]),
    ['k', 'P(k)', 'k/M'], `os 24 k's mais prováveis de ${fmt(i.M)}`);
}

function fillTable(rows, headers, note) {
  $('sim-table').innerHTML =
    (note ? `<p class="fine">${note}</p>` : '') + (rows.length ? tableHTML(rows, headers) : '');
}

function drawPhasor() {
  const i = sim.inst;
  const k = Number($('sim-k').value);
  $('sim-k-val').textContent = String(k);
  const sRes = sim.orbitSel ?? 0;
  const { angles, total, shown } = phasorsAt(i, k, sRes);
  chart($('sim-phasor'), (c) => {
    // |soma dos Q fasores|/Q — recomputa com todos, não só os desenhados.
    let re = 0, im = 0;
    for (let j = 0, x = sRes; x < i.M; j++, x += i.r) {
      const th = (-2 * Math.PI * k * x) / i.M;
      re += Math.cos(th); im += Math.sin(th);
    }
    const frac = Math.hypot(re, im) / total;
    drawPhasorSum(c, angles, { label: `|soma| = ${(frac * 100).toFixed(1)}% do máximo` });
    return null;
  }, null);
  const p = sim.fs.probs[k];
  $('sim-phasor-text').innerHTML =
    `Em k = <b>${k}</b>, os ${fmt(total)} fasores do pente ` +
    (shown < total ? `(desenhando os primeiros ${shown}) ` : '') +
    `somam para P(k) = <b>${p.toExponential(2)}</b>. ` +
    `Os picos vivem em k ≈ múltiplos de M/r = ${(i.M / i.r).toFixed(1)}. ` +
    `<i>Nenhuma barra foi "escolhida" por ninguém: só sobreviveu quem interferiu construtivamente.</i>`;
}
$('sim-k').addEventListener('input', drawPhasor);

document.querySelectorAll('.step-btn').forEach((b) =>
  b.addEventListener('click', () => showStage(Number(b.dataset.step))));
$('sim-prev').addEventListener('click', () => showStage(Math.max(0, sim.stage - 1)));
$('sim-next').addEventListener('click', () => showStage(Math.min(3, sim.stage + 1)));

function doMeasure() {
  const i = sim.inst;
  sim.attempts++;
  const k = sampleK(sim.fs.probs);
  sim.measured = k;
  drawStageChart();
  const cf = continuedFractions(k, i.M, i);
  const fr = factorsFromPeriod(i, cf.r);

  const cfRows = cf.steps.map(({ p, q, verdict }) => [`${p}/${q}`, verdict]);
  let html = `<div class="measure-out">
    <p class="mono big-read">k = ${k} &nbsp;→&nbsp; k/M = ${k}/${i.M}</p>
    <h4>Frações continuadas de ${k}/${i.M}</h4>
    ${cfRows.length ? tableHTML(cfRows, ['convergente p/q', 'q é o período?']) : '<p class="fine">k = 0 não carrega informação — azar honesto.</p>'}`;

  if (fr.ok) {
    html += `<p class="result-ok">r = ${cf.r} &nbsp;→&nbsp; ${i.a}<sup>${cf.r}/2</sup> mod ${i.N} = ${fr.half}
      &nbsp;→&nbsp; mdc(${fr.half}∓1, ${i.N}) &nbsp;→&nbsp;
      <b>${i.N} = ${fr.f1} × ${fr.f2}</b> 🎉</p>
      <p class="fine">em ${sim.attempts} ${sim.attempts === 1 ? 'medição' : 'medições'}.
      A conta final foi clássica; o quantum serviu só para achar r — que é
      exatamente a parte que nenhum computador clássico sabe fazer rápido.</p>`;
  } else {
    html += `<p class="result-bad">${fr.why}.</p>
      <p class="fine">tentativa ${sim.attempts} — o Shor real também repete: a
      probabilidade de sucesso por medição é alta, mas não é 1.</p>`;
  }
  html += '</div>';
  $('sim-result').innerHTML = html;
  $('sim-again').classList.remove('hidden');
}
$('sim-measure').addEventListener('click', doMeasure);
$('sim-again').addEventListener('click', doMeasure);

// ---------------------------------------------------------------------------
// Capítulo 6 — hardware real
// ---------------------------------------------------------------------------

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
    const r = await (await fetch('/api/runs')).json();
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
      uniform: true,
    }), (k) => {
      const parts = [`k = ${k}`];
      if (res) parts.push(`medido: ${((values[k] ?? 0) * 100).toFixed(1)}% (${res.counts[k] ?? 0}/${res.shots})`);
      parts.push(`ideal: ${((idealNum[k] ?? 0) * 100).toFixed(1)}%`);
      return parts.join('<br>');
    });

    const rows = [];
    for (let k = 0; k < M; k++) {
      const mv = res ? (values[k] ?? 0) : null;
      const iv = idealNum[k] ?? 0;
      if ((mv ?? 0) > 0 || iv > 0) {
        rows.push([k, mv != null ? (mv * 100).toFixed(2) + '%' : '—', (iv * 100).toFixed(2) + '%']);
      }
    }
    card.querySelector('.hw-tbl').innerHTML = tableHTML(rows, ['k', 'medido', 'ideal']);
  }
}
loadHardware();
