/**
 * Renderizadores de visualização — canvas 2D, sem bibliotecas.
 *
 * Paleta de séries validada (CVD + contraste) sobre o fundo #0d0f1a:
 *   medido  #14a898   ideal  #8b6cf6   resultante/acento  #f062a6
 * A identidade nunca é só cor: "medido" é barra cheia, "ideal" é traço,
 * e toda fase codificada em matiz tem o ângulo redundante no fasor/tooltip.
 */

export const SERIES = {
  measured: '#14a898',
  ideal: '#8b6cf6',
  accent: '#f062a6',
  grid: '#232741',
  axis: '#666d90',
  text: '#9aa0c0',
  surface: '#0d0f1a',
};

/** Matiz cíclico para fase (rad) — luminância fixa para não competir com a
 * altura. A roda é girada para fase 0 cair no ciano da casa (não no vermelho,
 * que leria como "erro"). */
export function phaseColor(phase) {
  const deg = (((phase / (2 * Math.PI)) * 360) % 360 + 360 + 175) % 360;
  return `hsl(${deg.toFixed(1)}, 72%, 62%)`;
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * Histograma de distribuição sobre k (ou sobre valores arbitrários).
 *
 * opts:
 *   values     Float64Array|number[]  alturas (probabilidades)
 *   phases     opcional: fase por barra (matiz)
 *   ideal      opcional: {k: prob} — traços violeta por cima
 *   labels     opcional: rótulo por índice (senão o índice)
 *   uniform    opcional: desenha linha tracejada em 1/n ("ruído uniforme")
 *   highlight  opcional: índice destacado (após medição)
 *   maxY       opcional: teto do eixo y
 * Devolve {hitTest(px) -> índice} para o tooltip.
 */
export function drawHistogram(canvas, opts) {
  const s = setupCanvas(canvas);
  if (!s) return null;
  const { ctx, w, h } = s;
  const values = opts.values;
  const n = values.length;
  const padL = 44, padR = 8, padT = 10, padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  let maxY = opts.maxY ?? 0;
  if (!maxY) {
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, values[i]);
    if (opts.ideal) for (const v of Object.values(opts.ideal)) maxY = Math.max(maxY, v);
    maxY = maxY > 0 ? maxY * 1.15 : 1;
  }

  ctx.clearRect(0, 0, w, h);

  // Grade recessiva: 3 linhas horizontais + rótulos do eixo y.
  ctx.strokeStyle = SERIES.grid;
  ctx.fillStyle = SERIES.text;
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Eixo em % quando o dado é probabilidade — "25%" fala com todo mundo,
  // "0.25" só com quem já sabia.
  const pm = maxY * 100;
  const decimals = opts.percent
    ? (pm >= 30 ? 0 : pm >= 3 ? 1 : 2)
    : (maxY >= 3 ? 0 : maxY >= 0.3 ? 2 : maxY >= 0.03 ? 3 : 4);
  for (let i = 0; i <= 3; i++) {
    const yv = (maxY * i) / 3;
    const y = padT + plotH - (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    const label = opts.percent ? (yv * 100).toFixed(decimals) + '%' : yv.toFixed(decimals);
    ctx.fillText(label, padL - 6, y);
  }

  const slot = plotW / n;
  const gap = slot >= 5 ? 2 : slot >= 2.5 ? 1 : 0;
  let barW = Math.max(slot - gap, 1);
  let inset = gap / 2;
  if (barW > 72) { barW = 72; inset = (slot - barW) / 2; } // poucas barras: não virar laje
  const round = barW >= 6 ? 3 : 0;

  // Barras (série "medido"/amplitudes).
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v <= 0) continue;
    const x = padL + i * slot + inset;
    const bh = Math.max((v / maxY) * plotH, v > 0 ? 1 : 0);
    const y = padT + plotH - bh;
    ctx.fillStyle = opts.phases ? phaseColor(opts.phases[i]) : SERIES.measured;
    if (opts.highlight != null && i !== opts.highlight) ctx.globalAlpha = 0.25;
    if (round) {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bh, [round, round, 0, 0]);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, bh);
    }
    ctx.globalAlpha = 1;
  }

  // Linha "ruído uniforme" de referência.
  if (opts.uniform) {
    const y = padT + plotH - (1 / n / maxY) * plotH;
    ctx.strokeStyle = SERIES.axis;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Traços da série "ideal".
  if (opts.ideal) {
    ctx.strokeStyle = SERIES.ideal;
    ctx.lineWidth = 2.5;
    for (const [k, v] of Object.entries(opts.ideal)) {
      const i = Number(k);
      if (i < 0 || i >= n) continue;
      const x = padL + i * slot + inset;
      const y = padT + plotH - (v / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x + barW + 2, y);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // Eixo x: régua esparsa.
  ctx.fillStyle = SERIES.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = n <= 16 ? n : 8;
  const step = Math.max(1, Math.round(n / ticks));
  for (let i = 0; i < n; i += step) {
    const x = padL + i * slot + slot / 2;
    ctx.fillText(String(opts.labels ? opts.labels[i] : i), x, padT + plotH + 6);
  }

  return {
    hitTest(px, py) {
      const rect = canvas.getBoundingClientRect();
      const x = px - rect.left - padL;
      const y = py - rect.top;
      if (x < 0 || x >= plotW || y < 0 || y > h) return -1;
      return Math.min(n - 1, Math.floor(x / slot));
    },
  };
}

/**
 * Soma de fasores: as flechas e^{iθ} de cabeça em cauda + a resultante.
 * angles: lista de ângulos; total: quantos existem de verdade (se > angles,
 * a legenda avisa que só uma parte está desenhada).
 */
export function drawPhasorSum(canvas, angles, opts = {}) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);

  const n = angles.length;
  if (n === 0) return;

  // Caminho cabeça-em-cauda no plano complexo.
  const pts = [{ x: 0, y: 0 }];
  let cx = 0, cy = 0;
  for (const th of angles) {
    cx += Math.cos(th);
    cy += Math.sin(th);
    pts.push({ x: cx, y: cy });
  }

  // Enquadramento: caber o caminho todo com folga.
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 2);
  const scale = (Math.min(w, h) - 36) / span;
  const ox = w / 2 - ((minX + maxX) / 2) * scale;
  const oy = h / 2 + ((minY + maxY) / 2) * scale;
  const X = (p) => ox + p.x * scale;
  const Y = (p) => oy - p.y * scale;

  // Flechinhas individuais. opts.mono usa uma cor só (widgets didáticos);
  // sem mono, o matiz é a fase — e o ângulo desenhado é a codificação
  // redundante da mesma fase.
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1];
    ctx.strokeStyle = opts.mono ? '#35e6d4' : phaseColor(angles[i]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
    ctx.stroke();
    // Ponta da flecha.
    const ang = Math.atan2(Y(b) - Y(a), X(b) - X(a));
    const hs = Math.min(9, scale * 0.6);
    if (hs > 2.5) {
      ctx.beginPath();
      ctx.moveTo(X(b), Y(b));
      ctx.lineTo(X(b) - hs * Math.cos(ang - 0.45), Y(b) - hs * Math.sin(ang - 0.45));
      ctx.moveTo(X(b), Y(b));
      ctx.lineTo(X(b) - hs * Math.cos(ang + 0.45), Y(b) - hs * Math.sin(ang + 0.45));
      ctx.stroke();
    }
  }

  // Resultante: desenhada DESLOCADA em paralelo (como uma cota de desenho
  // técnico) — em cima do caminho ela esconderia as setinhas quando tudo
  // está alinhado, que é justamente o caso mais importante.
  const end = pts[n];
  const len = Math.hypot(end.x, end.y);
  ctx.strokeStyle = SERIES.accent;
  ctx.lineWidth = 3;
  if (len * scale > 4) {
    const dirX = (X(end) - X(pts[0])) / (len * scale);
    const dirY = (Y(end) - Y(pts[0])) / (len * scale);
    const off = 12;
    const ox2 = -dirY * off, oy2 = dirX * off;
    const x0 = X(pts[0]) + ox2, y0 = Y(pts[0]) + oy2;
    const x1 = X(end) + ox2, y1 = Y(end) + oy2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 11 * Math.cos(ang - 0.45), y1 - 11 * Math.sin(ang - 0.45));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 11 * Math.cos(ang + 0.45), y1 - 11 * Math.sin(ang + 0.45));
    ctx.stroke();
  } else {
    // Soma (quase) zero: um pontinho onde o caminho voltou ao início.
    ctx.fillStyle = SERIES.accent;
    ctx.beginPath();
    ctx.arc(X(pts[0]), Y(pts[0]), 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Diagrama do circuito de estimativa de fase, em SVG.
 * Devolve o elemento raiz; `highlightStage(idx)` acende uma etapa (0..3).
 */
export function circuitSVG(container, inst, labels = {}) {
  const m = inst.m;
  const L = {
    counting: labels.counting ?? `${m} qubits — contagem`,
    work: labels.work ?? `${inst.nWork} qubits — trabalho`,
    aria: labels.aria ?? `Circuito de estimativa de fase com ${m} qubits de contagem`,
  };
  const showC = Math.min(m, 4);          // fios de contagem desenhados
  const elide = m > showC;
  const rows = showC + (elide ? 1 : 0) + 1; // +1 = trabalho (feixe)
  const rowH = 44, colW = 74;
  const stages = 4;                      // H | U^2^t | iQFT | medição
  const width = 120 + colW * (stages + Math.min(m, 3)) + 40;
  const height = rows * rowH + 30;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'circuit');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', L.aria);

  const el = (name, attrs, text) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const yOf = (row) => 26 + row * rowH;
  const workRow = rows - 1;

  const groups = [[], [], [], []]; // por etapa, para o highlight

  // Fios + rótulos.
  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const y = yOf(rIdx);
    const isWork = rIdx === workRow;
    const isElide = elide && rIdx === showC;
    if (isElide) {
      svg.appendChild(el('text', { x: 34, y: y + 4, class: 'c-label' }, '⋮'));
      continue;
    }
    const label = isWork ? `|1⟩` : `|0⟩`;
    svg.appendChild(el('text', { x: 10, y: y + 4, class: 'c-label' },
      isWork ? `${label}` : label));
    if (isWork) {
      // Feixe: linha dupla = registrador de nWork qubits.
      svg.appendChild(el('line', { x1: 46, y1: y - 2, x2: width - 16, y2: y - 2, class: 'c-wire' }));
      svg.appendChild(el('line', { x1: 46, y1: y + 2, x2: width - 16, y2: y + 2, class: 'c-wire' }));
      svg.appendChild(el('text', { x: 52, y: y - 8, class: 'c-small' }, L.work));
    } else {
      svg.appendChild(el('line', { x1: 46, y1: y, x2: width - 16, y2: y, class: 'c-wire' }));
    }
  }
  svg.appendChild(el('text', { x: 52, y: 12, class: 'c-small' }, L.counting));

  // Etapa 0: coluna de H.
  const hx = 70;
  for (let rIdx = 0; rIdx < showC; rIdx++) {
    const y = yOf(rIdx);
    const g = el('g', { class: 'c-stage' });
    g.appendChild(el('rect', { x: hx - 13, y: y - 13, width: 26, height: 26, class: 'c-gate' }));
    g.appendChild(el('text', { x: hx, y: y + 4, class: 'c-gate-t' }, 'H'));
    svg.appendChild(g);
    groups[0].push(g);
  }

  // Etapa 1: controlados-U^{2^t} (desenha até 3, com "…" se houver mais).
  const shownU = Math.min(m, 3);
  for (let t = 0; t < shownU; t++) {
    const x = 130 + t * colW;
    const ctrlRow = t < showC ? t : showC - 1;
    const yc = yOf(ctrlRow);
    const yw = yOf(workRow);
    const g = el('g', { class: 'c-stage' });
    g.appendChild(el('line', { x1: x, y1: yc, x2: x, y2: yw - 16, class: 'c-wire' }));
    g.appendChild(el('circle', { cx: x, cy: yc, r: 4, class: 'c-dot' }));
    g.appendChild(el('rect', { x: x - 26, y: yw - 16, width: 52, height: 32, class: 'c-gate' }));
    g.appendChild(el('text', { x, y: yw - 2, class: 'c-gate-t c-gate-small' }, `a${sup(2 ** t)}`));
    g.appendChild(el('text', { x, y: yw + 11, class: 'c-small', 'text-anchor': 'middle' }, `mod N`));
    svg.appendChild(g);
    groups[1].push(g);
  }
  if (m > shownU) {
    const g = el('g', { class: 'c-stage' });
    g.appendChild(el('text', { x: 130 + shownU * colW - 20, y: yOf(workRow) + 1, class: 'c-label' }, '…'));
    svg.appendChild(g);
    groups[1].push(g);
  }

  // Etapa 2: caixa QFT⁻¹ sobre a contagem.
  const qx = 130 + shownU * colW + 10;
  {
    const g = el('g', { class: 'c-stage' });
    const y0 = yOf(0) - 16;
    const y1 = yOf(elide ? showC : showC - 1) + 16;
    g.appendChild(el('rect', { x: qx, y: y0, width: 56, height: y1 - y0, class: 'c-gate' }));
    g.appendChild(el('text', { x: qx + 28, y: (y0 + y1) / 2 + 4, class: 'c-gate-t c-gate-small' }, 'QFT⁻¹'));
    svg.appendChild(g);
    groups[2].push(g);
  }

  // Etapa 3: medidores na contagem.
  const mx = qx + 84;
  for (let rIdx = 0; rIdx < showC; rIdx++) {
    const y = yOf(rIdx);
    const g = el('g', { class: 'c-stage' });
    g.appendChild(el('rect', { x: mx - 14, y: y - 13, width: 28, height: 26, class: 'c-gate' }));
    g.appendChild(el('path', { d: `M ${mx - 8} ${y + 6} A 8 8 0 0 1 ${mx + 8} ${y + 6}`, class: 'c-meter' }));
    g.appendChild(el('line', { x1: mx, y1: y + 6, x2: mx + 6, y2: y - 5, class: 'c-meter' }));
    svg.appendChild(g);
    groups[3].push(g);
  }

  container.replaceChildren(svg);
  return {
    highlightStage(idx) {
      groups.forEach((gs, i) =>
        gs.forEach((g) => g.classList.toggle('c-active', i === idx)));
    },
  };
}

function sup(n) {
  const map = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(n).split('').map((d) => map[d] ?? d).join('');
}

/** Roda de fases: legenda do matiz cíclico. */
export function drawPhaseWheel(canvas) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const r0 = Math.min(w, h) / 2 - 14, r1 = r0 - 8;
  for (let d = 0; d < 360; d += 3) {
    const a0 = (d * Math.PI) / 180;
    const a1 = ((d + 3.5) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, a0, a1);
    ctx.arc(cx, cy, r1, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = phaseColor(a0);
    ctx.fill();
  }
  ctx.fillStyle = SERIES.text;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('0', cx + r0 + 8, cy + 3);
  ctx.fillText('π', cx - r0 - 8, cy + 3);
}
