/**
 * Cola da página: widgets dos capítulos, o simulador e a seção de hardware.
 * Toda a matemática vive em sim.js; todo o desenho em viz.js; todo o texto
 * em i18n/<lang>.js. Aqui é só estado de interface.
 *
 * Troca de idioma = salvar + recarregar: os tooltips e legendas vivem em
 * closures de gráfico, e re-renderizar tudo ao vivo custaria mais código do
 * que um reload custa ao visitante (a página é estática e leve).
 */

import {
  prepare, finalState, sampleK, continuedFractions,
  factorsFromPeriod, validateN, validBases, modpow, gcd, PRESET_N,
} from './sim.js';
import { drawHistogram, circuitSVG, SERIES } from './viz.js';
import { LOCALES, pickLocale, loadStrings, switchLocale } from './i18n.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Idioma: carrega o dicionário antes de qualquer render
// ---------------------------------------------------------------------------

const LANG = pickLocale();
const INTL = LOCALES[LANG].intl;
const S = await loadStrings(LANG);

/** t('chave', {param: valor}) — interpolação de {param} no dicionário. */
function t(key, params = {}) {
  let s = S[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const fmt = (x) => x.toLocaleString(INTL);
const fmtBig = (n) => BigInt.prototype.toLocaleString
  ? (1n << BigInt(n)).toLocaleString(INTL)
  : (1n << BigInt(n)).toString();

/** Probabilidade para humanos: "25%", "1,6%" — nunca "2.5e-1". */
const fmtP = (p) => {
  if (p <= 0) return '0%';
  if (p < 0.0001) return '<0,01%';
  const v = p * 100;
  const dec = v >= 10 ? 0 : v >= 1 ? 1 : 2;
  return v.toLocaleString(INTL, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
};

// Aplica o dicionário sobre o HTML (o texto-fonte em português fica no
// arquivo como fallback e conteúdo do primeiro paint).
function applyI18n() {
  document.documentElement.lang = INTL.split('-u-')[0];
  document.documentElement.dir = LOCALES[LANG].dir;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.desc'));
  // Canônica auto-referente: cada variante ?lang= é sua própria canônica
  // (com hreflang apontando as irmãs); a raiz fica limpa como x-default.
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement('link');
    canon.rel = 'canonical';
    document.head.appendChild(canon);
  }
  const urlLang = new URL(location.href).searchParams.get('lang');
  canon.href = 'https://quantum.vynstream.com/' +
    (urlLang && LOCALES[urlLang] ? `?lang=${urlLang}` : '');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  // Seletor de idioma.
  const sel = $('lang-sel');
  for (const [code, loc] of Object.entries(LOCALES)) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = loc.native;
    if (code === LANG) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => switchLocale(sel.value));
}
applyI18n();

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
      : `<span class="sw sw-dash" style="background:${color}"></span>`;
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
    (i) => t('q.tip', {
      i, amp: mags[i].toFixed(3), ph: phases[i].toFixed(2),
      prob: fmtP(mags[i] ** 2),
    }));
  $('q-state').textContent = qubit.hops % 2 === 1 ? t('q.state1') : '|0⟩';
  $('q-caption').textContent = qubit.hops % 2 === 1
    ? t('q.cap1')
    : qubit.hops === 0 ? t('q.cap0') : t('q.cap2');
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

const HILBERT_MARKS = [[10, 'hil.m10'], [20, 'hil.m20'], [30, 'hil.m30'],
  [33, 'hil.m33'], [38, 'hil.m38'], [50, 'hil.m50'], [60, 'hil.m60']];

function hilbertDraw() {
  const n = Number($('hilbert-n').value);
  let note = '';
  for (const [lim, key] of HILBERT_MARKS) if (n >= lim) note = t(key);
  $('hilbert-read').innerHTML =
    (n === 1 ? t('hil.read1') : t('hil.read', { n, dims: fmtBig(n) })) +
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
    (i) => t('per.tip', { x: i, v: vals[i] }));
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

function errText(err) {
  return err ? t(`err.${err.code}`, { p: err.p ?? '' }) : '';
}

function refreshBases() {
  const N = Number($('sim-n').value);
  const err = validateN(N);
  $('sim-err').textContent = errText(err);
  const sel = $('sim-a');
  sel.replaceChildren();
  if (err) return;
  const bases = validBases(N);
  for (const { a, r } of bases) {
    const o = document.createElement('option');
    o.value = String(a);
    o.textContent = baseWorks(N, a, r) ? `a = ${a}` : t('alg.badBase', { a });
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
  if (err) { $('sim-err').textContent = errText(err); return; }
  const a = Number($('sim-a').value);
  const inst = prepare(N, a);
  const fs = finalState(inst);
  const { good, f1, f2 } = goodShots(N, a, inst.M);

  $('sim-body').classList.remove('hidden');
  $('sim-regs').innerHTML = t('alg.regs', {
    m: inst.m, n: inst.nWork, mn: inst.m + inst.nWork, dims: fmt(inst.dim),
  });
  circuitSVG($('sim-circuit'), inst, {
    counting: t('circ.counting', { m: inst.m }),
    work: t('circ.work', { n: inst.nWork }),
    aria: t('circ.aria', { m: inst.m }),
  });

  // O gráfico: o que o computador quântico devolve.
  const drawDist = (winK) => {
    $('sim-legend').innerHTML = legendHTML([
      ['bar', SERIES.measured, t('leg.chance')],
      ...(winK != null ? [['dash', SERIES.accent, t('leg.win', { k: winK })]] : []),
    ]);
    chart($('sim-canvas'), (c) => drawHistogram(c, {
      values: fs.probs, percent: true, uniform: true,
      highlight: winK ?? null,
    }), (k) => t('tip.k', {
      k, p: fmtP(fs.probs[k]),
      good: good.has(k) ? t('tip.good') : t('tip.bad'),
    }));
    const top = [...fs.probs].map((p, k) => [k, p]).sort((x, y) => y[1] - x[1])
      .slice(0, 24).sort((x, y) => x[0] - y[0]);
    $('sim-table').innerHTML = tableHTML(
      top.map(([k, p]) => [k, fmtP(p), good.has(k) ? t('tbl.leads', { f1, f2 }) : '—']),
      [t('tbl.k'), t('tbl.chance'), t('tbl.factors')]);
  };

  // Base que nunca fatora: diz na cara, sem fingir que mede.
  if (good.size === 0) {
    drawDist(null);
    const why = t(`fr.${factorsFromPeriod(inst, inst.r).code}`, { r: inst.r });
    $('sim-result').innerHTML = `
      <div class="verdict verdict-bad">
        <div class="v-big">${t('v.badbase.title')}</div>
        <div class="v-sub">${t('v.badbase.sub', { why })}</div>
      </div>`;
    return;
  }

  // Mede sozinho até cair num k bom (30 é teto de segurança).
  const attempts = [];
  let win = null;
  for (let tRun = 0; tRun < 30 && win == null; tRun++) {
    const k = sampleK(fs.probs);
    attempts.push(k);
    if (good.has(k)) win = k;
  }
  drawDist(win);

  if (win == null) {
    $('sim-result').innerHTML = `
      <div class="verdict verdict-bad">
        <div class="v-big">${t('v.unlucky.title')}</div>
        <div class="v-sub">${t('v.unlucky.sub')}</div>
      </div>
      <p class="controls"><button id="sim-rerun" class="btn small ghost">${t('alg.rerun')}</button></p>`;
    $('sim-rerun').addEventListener('click', runShor);
    return;
  }

  const tries = attempts.length;
  const cf = continuedFractions(win, inst.M, inst);
  const expr = halfExpr(N, a, cf.r);
  const pGood = [...good].reduce((s2, k) => s2 + fs.probs[k], 0);
  const s0 = Math.round((win * cf.r) / inst.M);
  const cfRows = cf.steps.map(({ p, q, status }) => [`${p}/${q}`,
    status === 'period' ? t('how.cfYes', { q, N })
      : status === 'overflow' ? t('how.cfOver', { q, N }) : t('how.cfNo', { q, N })]);
  const subKey = tries === 1 ? 'v.ok.first' : 'v.ok.nth';
  $('sim-result').innerHTML = `
    <div class="verdict verdict-ok">
      <div class="v-big">${N} = ${f1} × ${f2}</div>
      <div class="v-sub">${t(subKey, { tries, ks: attempts.join(', '), win, r: cf.r })}</div>
    </div>
    <details class="how"><summary>${t('how.summary', { win, f1, f2 })}</summary>
      <p class="fine">${t('how.p1', { win, M: inst.M, s0, r: cf.r })}</p>
      ${tableHTML(cfRows, [t('how.cfHead1'), t('how.cfHead2')])}
      <p class="fine">${t('how.p2', { r: cf.r, expr: expr.text, half: expr.half, N, f1, f2 })}</p>
      ${tries > 1 ? `<p class="fine">${t('how.p3', { pGood: fmtP(pGood) })}</p>` : ''}
    </details>
    <p class="controls"><button id="sim-rerun" class="btn small ghost">${t('alg.rerun')}</button></p>`;
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
function halfExpr(N, a, r) {
  if (r % 2 === 0) {
    const half = modpow(a, r / 2, N);
    return { half, text: t('expr.even', { a, rh: r / 2, N, half }) };
  }
  const b = Math.round(Math.sqrt(a));
  const half = modpow(b, r, N);
  return { half, text: t('expr.odd', { a, b, r, N, half }) };
}

/** O parágrafo que faltava nos cards: por que ESTES picos viram os fatores. */
function explainPeaks(c, M, good, f1, f2, drowned = false) {
  const { N, a, r } = c;
  const peaks = [...new Set(Array.from({ length: r }, (_, s) => Math.round((s * M) / r) % M))]
    .sort((x, y) => x - y);
  const stepStr = Number.isInteger(M / r) ? String(M / r) : `${M}/${r} ≈ ${(M / r).toFixed(2)}`;
  const g0 = Math.min(...good);
  const s0 = Math.round((g0 * r) / M);
  const expr = halfExpr(N, a, r);
  const badsArr = peaks.filter((k) => !good.has(k));
  const bads = t(badsArr.length > 1 ? 'exp.badsMany' : 'exp.badsOne',
    { ks: badsArr.join(', k = ') });
  const open = t(drowned ? 'exp.openDrowned' : 'exp.open',
    { step: stepStr, peaks: peaks.join(', ') });
  return `<p class="fine hw-why"><b>${t(drowned ? 'exp.titleDrowned' : 'exp.title')}:</b> ` +
    t('exp.body', { open, g0, M, s0, r, expr: expr.text, half: expr.half, N, f1, f2, bads }) +
    '</p>';
}

async function loadHardware() {
  let meta = null;
  try {
    meta = await (await fetch('data/circuits.json')).json();
  } catch {
    $('hw-status').textContent = '…';
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
    ? t('hw.status.run', { backend: run.backend, job: run.job_id, date: run.completed_at }) +
      (run.charged_seconds ? t('hw.status.charged', { s: run.charged_seconds }) : '')
    : t('hw.status.none');

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
        <h3>${t(`hw.c.${c.id}.title`)}</h3>
        <span class="chip">${t(`hw.kind.${c.kind}`)}</span>
      </div>
      <p class="fine">${t(`hw.c.${c.id}.note`)}</p>
      <p class="hw-stats mono">${t('hw.stats', {
        N: c.N, a: c.a, q: c.logical_qubits, depth: fmt(st.depth),
        twoq: fmt(st.twoq_gates), shots: fmt(c.shots),
      })}</p>
      <div class="legend">${legendHTML([
        ...(res ? [['bar', SERIES.measured, t('hw.leg.measured')]] : []),
        ['dash', SERIES.ideal, t('hw.leg.ideal')],
        ['dash', SERIES.axis, t('hw.leg.uniform')],
      ])}</div>
      <canvas class="viz" height="200"></canvas>
      <div class="hw-concl"></div>
      <details class="tbl-details"><summary>${t('tbl.view')}</summary><div class="hw-tbl"></div></details>`;
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
      if (res) parts.push(t('hw.tip.meas', { pct: fmtP(values[k] ?? 0), n: res.counts[k] ?? 0, shots: res.shots }));
      parts.push(t('hw.tip.ideal', { pct: fmtP(idealNum[k] ?? 0) }));
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
        concl.innerHTML = `<div class="hw-verdict ok"><b>${t('hw.ok.title', { N: c.N, f1, f2 })}</b>
          <span>${t('hw.ok.sub', { hit: fmt(hit), shots: fmt(res.shots), pct: fmtP(frac), chance: fmtP(chance) })}</span></div>`;
      } else {
        concl.innerHTML = `<div class="hw-verdict bad"><b>${t('hw.bad.title')}</b>
          <span>${t('hw.bad.sub', { pct: fmtP(frac), chance: fmtP(chance), N: c.N, f1, f2 })}</span></div>`;
      }
    } else {
      const idealHit = [...good].reduce((s2, k) => s2 + (idealNum[k] ?? 0), 0);
      concl.innerHTML = `<p class="fine">${t('hw.idealOnly', { pct: fmtP(idealHit), f1, f2 })}</p>`;
    }
    concl.innerHTML += explainPeaks(c, M, good, f1, f2, drowned);

    const rows = [];
    for (let k = 0; k < M; k++) {
      const mv = res ? (values[k] ?? 0) : null;
      const iv = idealNum[k] ?? 0;
      if ((mv ?? 0) > 0 || iv > 0) {
        rows.push([k, mv != null ? fmtP(mv) : '—', fmtP(iv),
          good.has(k) ? t('tbl.leads', { f1, f2 }) : '—']);
      }
    }
    card.querySelector('.hw-tbl').innerHTML =
      tableHTML(rows, [t('tbl.k'), t('hw.tbl.meas'), t('hw.tbl.ideal'), t('tbl.factors')]);
  }
}
loadHardware();

// ---------------------------------------------------------------------------
// Contador de visitas — privacidade primeiro: o servidor não guarda IP;
// o identificador é hash(sal‖dia‖IP‖user-agent) e muda todo dia.
// ---------------------------------------------------------------------------

(async () => {
  try {
    const s = await (await fetch('/api/visit', { method: 'POST' })).json();
    if (!s.unique_visitors) return; // preview local ou sal ausente
    const line = $('stats-line');
    line.textContent = t('stats.line', {
      visitors: fmt(s.unique_visitors),
      countries: fmt(s.countries),
      pageviews: fmt(s.pageviews),
    });
    line.classList.remove('hidden');
  } catch { /* sem Worker (preview local): sem contador */ }
})();
