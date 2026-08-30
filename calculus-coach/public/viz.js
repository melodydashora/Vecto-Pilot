// Calc Coach interactive explorers — canvas widgets driven entirely by
// user-controlled sliders and buttons. Nothing animates on its own; the
// picture only changes when the learner moves a control. Every explorer
// pairs the graphic with an explicit numeric readout, because the numbers
// are evidence, not decoration.
//
// mountExplorer(container, spec) — spec: { kind, title?, params? }
// explorersFor(unit, skillId)    — ranked explorer specs for a skill/unit.

const PI = Math.PI;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
const palette = () => ({
  axis: cssVar('--muted'),
  grid: cssVar('--border'),
  curve: cssVar('--accent'),
  curve2: cssVar('--good'),
  warn: cssVar('--notyet'),
  text: cssVar('--text'),
  soft: cssVar('--accent-soft'),
});

// ------------------------------------------------------------- plot helper
function makePlot(canvas, { xmin, xmax, ymin, ymax, width = 620, height = 300 }) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.min(width, canvas.parentElement?.clientWidth || width);
  canvas.width = w * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = (x) => ((x - xmin) / (xmax - xmin)) * w;
  const Y = (y) => height - ((y - ymin) / (ymax - ymin)) * height;
  const p = palette();

  const clear = () => { ctx.clearRect(0, 0, w, height); };
  const grid = (stepX = 1, stepY = 1) => {
    ctx.strokeStyle = p.grid; ctx.lineWidth = 1;
    for (let x = Math.ceil(xmin / stepX) * stepX; x <= xmax; x += stepX) {
      ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), height); ctx.stroke();
    }
    for (let y = Math.ceil(ymin / stepY) * stepY; y <= ymax; y += stepY) {
      ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); ctx.stroke();
    }
  };
  const axes = () => {
    ctx.strokeStyle = p.axis; ctx.lineWidth = 1.5;
    if (ymin <= 0 && ymax >= 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); }
    if (xmin <= 0 && xmax >= 0) { ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), height); ctx.stroke(); }
  };
  const curve = (f, color = p.curve, widthPx = 2.2, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    const n = 400;
    for (let i = 0; i <= n; i++) {
      const x = xmin + ((xmax - xmin) * i) / n;
      const y = f(x);
      if (!Number.isFinite(y) || y < ymin - (ymax - ymin) || y > ymax + (ymax - ymin)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X(x), Y(y)); pen = true; } else ctx.lineTo(X(x), Y(y));
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  const seg = (x1, y1, x2, y2, color = p.curve2, widthPx = 2, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke(); ctx.setLineDash([]);
  };
  const dot = (x, y, color = p.curve, r = 4, open = false) => {
    ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, 2 * PI);
    if (open) { ctx.fillStyle = cssVar('--surface'); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
  };
  const rect = (x1, y1, x2, y2, fill, stroke) => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1;
    const a = X(x1), b = Y(y1), c = X(x2), d = Y(y2);
    ctx.fillRect(a, Math.min(b, d), c - a, Math.abs(d - b));
    ctx.strokeRect(a, Math.min(b, d), c - a, Math.abs(d - b));
  };
  const label = (txt, x, y, color = p.text) => {
    ctx.fillStyle = color; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(txt, X(x), Y(y));
  };
  const arrow = (x1, y1, x2, y2, color = p.warn) => {
    seg(x1, y1, x2, y2, color, 2.4);
    const ang = Math.atan2(Y(y2) - Y(y1), X(x2) - X(x1));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(x2), Y(y2));
    ctx.lineTo(X(x2) - 9 * Math.cos(ang - 0.4), Y(y2) - 9 * Math.sin(ang - 0.4));
    ctx.lineTo(X(x2) - 9 * Math.cos(ang + 0.4), Y(y2) - 9 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  };
  const polyStart = (color = p.warn, widthPx = 2.4) => { ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.beginPath(); };
  const polyTo = (x, y, first) => { if (first) ctx.moveTo(X(x), Y(y)); else ctx.lineTo(X(x), Y(y)); };
  const polyEnd = () => ctx.stroke();
  const shade = (points, fill) => {
    if (!points.length) return;
    ctx.fillStyle = fill; ctx.beginPath();
    ctx.moveTo(X(points[0][0]), Y(points[0][1]));
    for (const [x, y] of points.slice(1)) ctx.lineTo(X(x), Y(y));
    ctx.closePath(); ctx.fill();
  };
  return { ctx, w, height, X, Y, clear, grid, axes, curve, seg, dot, rect, label, arrow, polyStart, polyTo, polyEnd, shade, colors: p };
}

// ------------------------------------------------------------ ui helpers
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function addSlider(controls, { label, min, max, step, value, format = (v) => v }) {
  const wrap = el('label', 'viz-slider');
  const name = el('span', 'viz-slider-label', label);
  const input = el('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  const out = el('output', 'viz-slider-out', format(Number(value)));
  wrap.append(name, input, out);
  controls.appendChild(wrap);
  return {
    input,
    value: () => Number(input.value),
    onInput(cb) { input.addEventListener('input', () => { out.textContent = format(Number(input.value)); cb(Number(input.value)); }); },
    set(v) { input.value = v; out.textContent = format(Number(v)); },
  };
}

function addButtons(controls, options, initial, cb) {
  const group = el('div', 'viz-btn-group');
  let current = initial;
  const btns = options.map(({ id, text }) => {
    const b = el('button', 'viz-mode-btn', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === initial));
    b.addEventListener('click', () => {
      current = id;
      btns.forEach((bb, i) => bb.setAttribute('aria-pressed', String(options[i].id === id)));
      cb(id);
    });
    group.appendChild(b);
    return b;
  });
  controls.appendChild(group);
  return { value: () => current };
}

function readoutTable(parent, headers) {
  const table = el('table', 'simple viz-readout');
  table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
  parent.appendChild(table);
  return {
    set(rows) {
      table.tBodies[0].innerHTML = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    },
  };
}

const fmt = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : 'undefined');

// ------------------------------------------------------------- explorers
const EXPLORERS = {};

EXPLORERS['limit-approach'] = {
  title: 'Limit explorer: approach a point from both sides',
  build(root) {
    const f = (x) => (x === 1 ? NaN : (x * x - 1) / (x - 1));
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const d = addSlider(root.controls, { label: 'Distance from x = 1', min: 0.001, max: 1, step: 0.001, value: 1, format: (v) => v.toFixed(3) });
    const table = readoutTable(root.readout, ['side', 'x', 'f(x) = (x² − 1)/(x − 1)']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -1, xmax: 3, ymin: -0.5, ymax: 4 });
      plot.clear(); plot.grid(); plot.axes();
      plot.curve(f);
      plot.dot(1, 2, plot.colors.curve, 4.5, true); // the hole
      const dist = d.value();
      const xl = 1 - dist, xr = 1 + dist;
      plot.dot(xl, f(xl), plot.colors.warn); plot.dot(xr, f(xr), plot.colors.curve2);
      plot.seg(xl, 0, xl, f(xl), plot.colors.warn, 1.2, [4, 4]);
      plot.seg(xr, 0, xr, f(xr), plot.colors.curve2, 1.2, [4, 4]);
      table.set([
        ['from the left', fmt(xl), fmt(f(xl))],
        ['from the right', fmt(xr), fmt(f(xr))],
      ]);
      note.textContent = dist <= 0.005
        ? 'Both sides agree to 3 decimal places. The limit is 2 — even though f(1) itself is undefined (the open dot).'
        : 'Drag the slider toward 0 and watch both f(x) columns close in on the same number.';
    };
    d.onInput(draw); draw();
  },
};

EXPLORERS['secant-tangent'] = {
  title: 'Derivative explorer: secant lines becoming the tangent',
  build(root) {
    const f = (x) => x * x, a = 1, fp = 2; // f'(1) = 2
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const h = addSlider(root.controls, { label: 'Step h', min: 0.001, max: 2, step: 0.001, value: 2, format: (v) => v.toFixed(3) });
    const table = readoutTable(root.readout, ['h', 'f(1+h) − f(1)', 'secant slope (f(1+h) − f(1)) / h']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -0.5, xmax: 3.5, ymin: -1, ymax: 10 });
      plot.clear(); plot.grid(1, 2); plot.axes();
      plot.curve(f);
      plot.curve((x) => fp * (x - a) + f(a), plot.colors.grid, 2, [6, 5]); // target tangent, quiet
      const hv = h.value();
      const slope = (f(a + hv) - f(a)) / hv;
      plot.seg(a - 0.6, f(a) + slope * -0.6, a + hv + 0.6, f(a) + slope * (hv + 0.6), plot.colors.curve2, 2.2);
      plot.dot(a, f(a), plot.colors.warn); plot.dot(a + hv, f(a + hv), plot.colors.curve2);
      table.set([[fmt(hv, 3), fmt(f(a + hv) - f(a)), fmt(slope)]]);
      note.textContent = hv <= 0.01
        ? `The secant slope is now ${fmt(slope)} — matching the tangent slope f′(1) = 2. That is the derivative: the limit of secant slopes as h → 0.`
        : 'Drag h toward 0: the green secant line tilts into the dashed tangent line, and the slope column approaches 2.';
    };
    h.onInput(draw); draw();
  },
};

EXPLORERS['function-pipeline'] = {
  title: 'Chain rule explorer: a two-stage function pipeline',
  build(root) {
    const g = (x) => x * x, gp = (x) => 2 * x;
    const f = (u) => Math.sin(u), fp = (u) => Math.cos(u);
    const y = (x) => f(g(x)), yp = (x) => fp(g(x)) * gp(x);
    root.graph.appendChild(el('div', 'viz-pipeline',
      `<span class="viz-box">x</span> ⟶ <span class="viz-box">g(x) = x²</span> ⟶ <span class="viz-box">u = x²</span> ⟶ <span class="viz-box">f(u) = sin u</span> ⟶ <span class="viz-box">y = sin(x²)</span>`));
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const xs = addSlider(root.controls, { label: 'Input x', min: -2.5, max: 2.5, step: 0.01, value: 1, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['inner rate g′(x) = 2x', 'outer rate f′(u) = cos(x²)', 'chain product dy/dx']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -2.6, xmax: 2.6, ymin: -1.6, ymax: 1.6, height: 260 });
      plot.clear(); plot.grid(1, 0.5); plot.axes();
      plot.curve(y);
      const xv = xs.value();
      const m = yp(xv);
      plot.seg(xv - 0.7, y(xv) - 0.7 * m, xv + 0.7, y(xv) + 0.7 * m, plot.colors.curve2, 2.2);
      plot.dot(xv, y(xv), plot.colors.warn);
      table.set([[fmt(gp(xv)), fmt(fp(g(xv))), `${fmt(fp(g(xv)))} × ${fmt(gp(xv))} = ${fmt(m)}`]]);
      note.textContent = 'The tangent slope of the composite equals the product of the two stage rates — the outer rate is evaluated at the inner output u = x², not at x. That is the chain rule.';
    };
    xs.onInput(draw); draw();
  },
};

EXPLORERS['linear-approx'] = {
  title: 'Linearization explorer: the tangent line as an approximation',
  build(root) {
    const f = (x) => Math.sqrt(x), a = 4;
    const L = (x) => 2 + (x - 4) / 4;
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const xs = addSlider(root.controls, { label: 'Evaluate at x', min: 0.5, max: 9, step: 0.01, value: 6, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['x', 'true √x', 'tangent L(x) = 2 + (x−4)/4', 'error L(x) − √x']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: 0, xmax: 9.5, ymin: 0, ymax: 4 });
      plot.clear(); plot.grid(1, 0.5); plot.axes();
      plot.curve(f); plot.curve(L, palette().curve2, 2, [6, 5]);
      const xv = xs.value();
      plot.dot(a, 2, plot.colors.warn);
      plot.dot(xv, f(xv), plot.colors.curve); plot.dot(xv, L(xv), plot.colors.curve2);
      plot.seg(xv, f(xv), xv, L(xv), plot.colors.warn, 1.4, [3, 3]);
      table.set([[fmt(xv, 2), fmt(f(xv)), fmt(L(xv)), fmt(L(xv) - f(xv))]]);
      note.textContent = Math.abs(xv - a) < 0.75
        ? 'Near x = 4 the error is tiny — that is local linearity.'
        : '√x is concave down, so its tangent line sits above the curve: the linearization overestimates, and the error grows as you move away from x = 4.';
    };
    xs.onInput(draw); draw();
  },
};

EXPLORERS['curve-analysis'] = {
  title: 'Curve analysis explorer: f, f′, and f″ together',
  build(root) {
    const f = (x) => x ** 3 - 3 * x, f1 = (x) => 3 * x * x - 3, f2 = (x) => 6 * x;
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const xs = addSlider(root.controls, { label: 'Position x', min: -2.4, max: 2.4, step: 0.01, value: 0.5, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['f(x) = x³ − 3x', "f′(x) = 3x² − 3", 'f″(x) = 6x']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -2.6, xmax: 2.6, ymin: -5, ymax: 5 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      plot.curve(f);
      plot.curve(f1, plot.colors.curve2, 1.6, [6, 4]);
      const xv = xs.value();
      const m = f1(xv);
      plot.seg(xv - 0.6, f(xv) - 0.6 * m, xv + 0.6, f(xv) + 0.6 * m, plot.colors.warn, 2);
      plot.dot(xv, f(xv), plot.colors.warn);
      table.set([[fmt(f(xv)), fmt(f1(xv)), fmt(f2(xv))]]);
      const inc = f1(xv) > 0 ? 'increasing (f′ > 0)' : f1(xv) < 0 ? 'decreasing (f′ < 0)' : 'at a critical point (f′ = 0)';
      const conc = f2(xv) > 0 ? 'concave up (f″ > 0)' : f2(xv) < 0 ? 'concave down (f″ < 0)' : 'at the inflection point (f″ = 0)';
      note.textContent = `At x = ${fmt(xv, 2)}, f is ${inc} and ${conc}. The dashed green curve is f′ — watch its sign, not its height.`;
    };
    xs.onInput(draw); draw();
  },
};

EXPLORERS['riemann-sum'] = {
  title: 'Riemann sum explorer: rectangles converging on the exact area',
  build(root) {
    const f = (x) => x * x, A = 0, B = 3, exact = 9; // ∫₀³ x² dx = 9
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const mode = addButtons(root.controls, [
      { id: 'left', text: 'Left' }, { id: 'right', text: 'Right' },
      { id: 'mid', text: 'Midpoint' }, { id: 'trap', text: 'Trapezoid' },
    ], 'left', () => draw());
    const n = addSlider(root.controls, { label: 'Number of pieces n', min: 1, max: 60, step: 1, value: 4, format: (v) => String(v) });
    const table = readoutTable(root.readout, ['method', 'n', 'approximate area', 'exact ∫₀³ x² dx', 'error']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -0.3, xmax: 3.4, ymin: -0.6, ymax: 9.6 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      const nv = n.value(), dx = (B - A) / nv, m = mode.value();
      let sum = 0;
      for (let i = 0; i < nv; i++) {
        const x0 = A + i * dx, x1 = x0 + dx;
        if (m === 'trap') {
          sum += ((f(x0) + f(x1)) / 2) * dx;
          plot.shade([[x0, 0], [x0, f(x0)], [x1, f(x1)], [x1, 0]], plot.colors.soft);
          plot.seg(x0, f(x0), x1, f(x1), plot.colors.curve2, 1.4);
          plot.seg(x0, 0, x0, f(x0), plot.colors.curve2, 1); plot.seg(x1, 0, x1, f(x1), plot.colors.curve2, 1);
        } else {
          const xs = m === 'left' ? x0 : m === 'right' ? x1 : (x0 + x1) / 2;
          sum += f(xs) * dx;
          plot.rect(x0, 0, x1, f(xs), plot.colors.soft, plot.colors.curve2);
        }
      }
      plot.curve(f);
      const labels = { left: 'Left sum', right: 'Right sum', mid: 'Midpoint sum', trap: 'Trapezoid sum' };
      table.set([[labels[m], String(nv), fmt(sum), '9', fmt(sum - exact)]]);
      note.textContent = m === 'left'
        ? 'x² is increasing on [0, 3], so every left rectangle sits under the curve — the left sum underestimates. Raise n and watch the error shrink.'
        : m === 'right'
          ? 'x² is increasing on [0, 3], so every right rectangle pokes above the curve — the right sum overestimates. Raise n and watch the error shrink.'
          : 'Raise n and watch the error column go to 0 — the definite integral is the limit of these sums.';
    };
    n.onInput(draw); draw();
  },
};

EXPLORERS['slope-field-euler'] = {
  title: 'Slope field and Euler’s method explorer',
  build(root) {
    // dy/dx = x − y, y(0) = 0 → exact y = x − 1 + e^(−x)
    const F = (x, y) => x - y;
    const exact = (x) => x - 1 + Math.exp(-x);
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const h = addSlider(root.controls, { label: 'Euler step size h', min: 0.05, max: 1, step: 0.05, value: 0.5, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['step', 'x', 'Euler y', 'slope x − y at (x, y)']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -0.4, xmax: 3.2, ymin: -0.8, ymax: 2.6 });
      plot.clear(); plot.axes();
      // slope field ticks
      for (let x = -0.25; x <= 3.1; x += 0.33) {
        for (let y = -0.7; y <= 2.5; y += 0.33) {
          const m = F(x, y), len = 0.11;
          const dx = len / Math.sqrt(1 + m * m), dy = m * dx;
          plot.seg(x - dx, y - dy, x + dx, y + dy, plot.colors.grid, 1.3);
        }
      }
      plot.curve(exact, plot.colors.curve, 2, [6, 5]);
      const hv = h.value();
      const rows = [];
      const steps = [[0, 0]];
      let x = 0, y = 0, i = 0;
      while (x < 3 - 1e-9 && i < 200) {
        if (rows.length < 7) rows.push([String(i), fmt(x, 2), fmt(y), fmt(F(x, y))]);
        y += hv * F(x, y);
        x += hv;
        steps.push([x, y]);
        i += 1;
      }
      // Draw the polyline first, then the dots — dot() starts a new canvas
      // path and would clobber an in-progress stroke.
      plot.polyStart(plot.colors.warn);
      steps.forEach(([sx, sy], k) => plot.polyTo(sx, sy, k === 0));
      plot.polyEnd();
      for (const [sx, sy] of steps.slice(1)) plot.dot(sx, sy, plot.colors.warn, 3);
      if (i >= 7) rows.push(['…', '…', '…', '…']);
      table.set(rows);
      note.textContent = `Solid orange: Euler’s method with h = ${hv.toFixed(2)} (follow the slope, step, re-read the slope, step again). Dashed blue: the exact solution y = x − 1 + e^(−x). At x = 3, Euler gives ${fmt(y)} vs exact ${fmt(exact(3))}. Smaller h hugs the true curve more closely.`;
    };
    h.onInput(draw); draw();
  },
};

EXPLORERS['area-between'] = {
  title: 'Area between curves explorer: the representative rectangle',
  build(root) {
    const top = (x) => 4 - x * x, bot = (x) => x + 2; // intersect at x = −2, 1; area = 4.5
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const xs = addSlider(root.controls, { label: 'Rectangle position x', min: -2, max: 1, step: 0.01, value: -0.5, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['x', 'top 4 − x²', 'bottom x + 2', 'height (top − bottom)', 'total area']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -3.2, xmax: 2.4, ymin: -1.5, ymax: 5 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      const pts = [];
      for (let x = -2; x <= 1.0001; x += 0.02) pts.push([x, top(x)]);
      for (let x = 1; x >= -2.0001; x -= 0.02) pts.push([x, bot(x)]);
      plot.shade(pts, plot.colors.soft);
      plot.curve(top); plot.curve(bot, plot.colors.curve2);
      const xv = xs.value();
      plot.rect(xv - 0.03, bot(xv), xv + 0.03, top(xv), plot.colors.warn, plot.colors.warn);
      table.set([[fmt(xv, 2), fmt(top(xv)), fmt(bot(xv)), fmt(top(xv) - bot(xv)), '4.5']]);
      note.textContent = 'Slide the orange rectangle: its height is always top minus bottom at that x. The integral ∫ from −2 to 1 of (4 − x²) − (x + 2) dx adds up every one of these heights × dx, giving 4.5.';
    };
    xs.onInput(draw); draw();
  },
};

EXPLORERS['parametric-motion'] = {
  title: 'Vector motion explorer: position, velocity, and speed',
  build(root) {
    const x = (t) => 3 * Math.cos(t), y = (t) => 2 * Math.sin(t);
    const xp = (t) => -3 * Math.sin(t), yp = (t) => 2 * Math.cos(t);
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const ts = addSlider(root.controls, { label: 'Time t (0 to 2π)', min: 0, max: 6.283, step: 0.01, value: 0.8, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['position ⟨x, y⟩', "velocity ⟨x′, y′⟩", 'speed = √(x′² + y′²)']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -4.4, xmax: 4.4, ymin: -3, ymax: 3, height: 320 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      const pts = [];
      for (let t = 0; t <= 2 * PI + 0.02; t += 0.02) pts.push([x(t), y(t)]);
      plot.polyStart(plot.colors.curve, 2.2);
      pts.forEach(([px, py], i) => plot.polyTo(px, py, i === 0));
      plot.polyEnd();
      const t = ts.value();
      plot.arrow(x(t), y(t), x(t) + xp(t) * 0.5, y(t) + yp(t) * 0.5);
      plot.dot(x(t), y(t), plot.colors.warn, 5);
      const speed = Math.hypot(xp(t), yp(t));
      table.set([[`⟨${fmt(x(t), 2)}, ${fmt(y(t), 2)}⟩`, `⟨${fmt(xp(t), 2)}, ${fmt(yp(t), 2)}⟩`, fmt(speed)]]);
      note.textContent = 'The orange arrow is the velocity vector ⟨x′(t), y′(t)⟩ — always tangent to the path. Speed is its length. Notice speed is largest where the ellipse is flattest (near the y-axis crossings) and smallest at the wide ends.';
    };
    ts.onInput(draw); draw();
  },
};

EXPLORERS['polar-area'] = {
  title: 'Polar area explorer: sweeping the cardioid r = 2 + 2cos θ',
  build(root) {
    const r = (th) => 2 + 2 * Math.cos(th);
    const sweptArea = (th) => 3 * th + 4 * Math.sin(th) + Math.sin(2 * th) / 2; // ∫ ½ r² dθ from 0
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const ths = addSlider(root.controls, { label: 'Sweep angle θ (0 to 2π)', min: 0, max: 6.283, step: 0.01, value: 1.6, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['θ', 'r(θ) = 2 + 2cos θ', 'area swept ½∫r² dθ', 'full area']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -1.8, xmax: 4.6, ymin: -2.6, ymax: 2.6, height: 320 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      const th = ths.value();
      const wedge = [[0, 0]];
      for (let t = 0; t <= th + 1e-9; t += 0.02) wedge.push([r(t) * Math.cos(t), r(t) * Math.sin(t)]);
      plot.shade(wedge, plot.colors.soft);
      const pts = [];
      for (let t = 0; t <= 2 * PI + 0.02; t += 0.02) pts.push([r(t) * Math.cos(t), r(t) * Math.sin(t)]);
      plot.polyStart(plot.colors.curve, 2.2);
      pts.forEach(([px, py], i) => plot.polyTo(px, py, i === 0));
      plot.polyEnd();
      plot.seg(0, 0, r(th) * Math.cos(th), r(th) * Math.sin(th), plot.colors.warn, 2.2);
      plot.dot(r(th) * Math.cos(th), r(th) * Math.sin(th), plot.colors.warn, 4.5);
      table.set([[fmt(th, 2), fmt(r(th)), fmt(sweptArea(th)), `6π ≈ ${fmt(6 * PI)}`]]);
      note.textContent = 'The orange ray has length r(θ). As θ sweeps, the shaded region grows by thin pie slices of area ½ r² dθ each — that is why polar area is ½∫r² dθ, not ∫r dθ. Note r shrinks to 0 at θ = π, where the ray reaches the cusp.';
    };
    ths.onInput(draw); draw();
  },
};

EXPLORERS['series-partial-sums'] = {
  title: 'Series explorer: partial sums of the geometric series',
  build(root) {
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const rs = addSlider(root.controls, { label: 'Common ratio r', min: -0.95, max: 1.25, step: 0.01, value: 0.5, format: (v) => v.toFixed(2) });
    const ns = addSlider(root.controls, { label: 'Terms in the partial sum, N', min: 1, max: 30, step: 1, value: 8, format: (v) => String(v) });
    const table = readoutTable(root.readout, ['r', 'N', 'partial sum Σ rⁿ (n = 0…N−1)', 'a / (1 − r) target']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const rv = rs.value(), N = ns.value();
      const sums = [];
      let s = 0, term = 1;
      for (let n = 0; n < 30; n++) { s += term; sums.push(s); term *= rv; }
      const limit = Math.abs(rv) < 1 ? 1 / (1 - rv) : null;
      const ymax = Math.max(3, ...sums.slice(0, N).map((v) => Math.abs(v))) * 1.15;
      const plot = makePlot(canvas, { xmin: 0, xmax: 31, ymin: -ymax, ymax, height: 280 });
      plot.clear(); plot.axes();
      if (limit !== null) plot.curve(() => limit, plot.colors.curve2, 1.6, [6, 5]);
      for (let n = 0; n < N; n++) {
        plot.seg(n + 1, 0, n + 1, sums[n], n === N - 1 ? plot.colors.warn : plot.colors.curve, 3);
        plot.dot(n + 1, sums[n], n === N - 1 ? plot.colors.warn : plot.colors.curve, 3);
      }
      table.set([[fmt(rv, 2), String(N), fmt(sums[N - 1]), limit === null ? 'no limit — |r| ≥ 1' : fmt(limit)]]);
      note.textContent = limit === null
        ? '|r| ≥ 1: the terms rⁿ do not shrink to 0, so the partial sums never settle — the series diverges. (At r = 1 they climb forever; at r < −1 they swing wider and wider.)'
        : 'Each bar is one more term added. With |r| < 1 the bars level off at the dashed line a/(1 − r) — convergence means the partial sums settle, not that the terms reach zero quickly.';
    };
    rs.onInput(draw); ns.onInput(draw); draw();
  },
};

EXPLORERS['taylor-series'] = {
  title: 'Taylor series explorer: polynomial approximations of sin x',
  build(root) {
    const f = Math.sin;
    const taylor = (x, deg) => {
      // sin x = Σ (−1)ᵏ x^(2k+1) / (2k+1)!
      let s = 0, sign = 1;
      for (let k = 0; 2 * k + 1 <= deg; k++) {
        let term = 1;
        for (let j = 1; j <= 2 * k + 1; j++) term *= x / j;
        s += sign * term;
        sign = -sign;
      }
      return s;
    };
    const canvas = el('canvas'); root.graph.appendChild(canvas);
    const deg = addSlider(root.controls, { label: 'Polynomial degree n', min: 1, max: 13, step: 2, value: 1, format: (v) => String(v) });
    const xe = addSlider(root.controls, { label: 'Check the error at x', min: -6, max: 6, step: 0.05, value: 3, format: (v) => v.toFixed(2) });
    const table = readoutTable(root.readout, ['degree', 'P(x) at your x', 'true sin x', '|error|']);
    const note = el('p', 'viz-note'); root.readout.appendChild(note);
    const draw = () => {
      const plot = makePlot(canvas, { xmin: -6.5, xmax: 6.5, ymin: -2.4, ymax: 2.4 });
      plot.clear(); plot.grid(1, 1); plot.axes();
      plot.curve(f);
      const d = deg.value(), xv = xe.value();
      plot.curve((x) => taylor(x, d), plot.colors.warn, 2.2, [7, 4]);
      plot.dot(xv, f(xv), plot.colors.curve); plot.dot(xv, Math.max(-2.35, Math.min(2.35, taylor(xv, d))), plot.colors.warn);
      table.set([[String(d), fmt(taylor(xv, d)), fmt(f(xv)), fmt(Math.abs(taylor(xv, d) - f(xv)))]]);
      note.textContent = `Degree ${d} uses ${Math.ceil(d / 2)} term${d > 1 ? 's' : ''} of x − x³/3! + x⁵/5! − … Each added term extends the region where the polynomial hugs sin x. Like successive refinement in code: more terms, wider radius of usefulness — and centered at 0, accuracy always decays as |x| grows.`;
    };
    deg.onInput(draw); xe.onInput(draw); draw();
  },
};

// ----------------------------------------------------- mapping & mounting
const KEYWORD_MAP = [
  [/riemann|trapezoid|sum|accumulat/, 'riemann-sum'],
  [/taylor|maclaurin|lagrange|power|polynomial-approx/, 'taylor-series'],
  [/series|converg|diverg|geometric|ratio|harmonic|alternat|p-series|comparison/, 'series-partial-sums'],
  [/polar/, 'polar-area'],
  [/vector|parametric|motion|speed/, 'parametric-motion'],
  [/euler|slope-field|field|differential/, 'slope-field-euler'],
  [/secant|tangent-slope|definition|difference-quotient|rate/, 'secant-tangent'],
  [/chain|composite/, 'function-pipeline'],
  [/linear|approx|lhopital|tangent-line/, 'linear-approx'],
  [/limit|asymptote|continu|squeeze|ivt/, 'limit-approach'],
  [/area|volume|arc/, 'area-between'],
  [/extrem|concav|inflection|increas|decreas|mvt|optimi|sketch|candidates/, 'curve-analysis'],
];

const UNIT_DEFAULTS = {
  1: ['limit-approach'],
  2: ['secant-tangent'],
  3: ['function-pipeline'],
  4: ['linear-approx', 'secant-tangent'],
  5: ['curve-analysis'],
  6: ['riemann-sum'],
  7: ['slope-field-euler'],
  8: ['area-between', 'riemann-sum'],
  9: ['parametric-motion', 'polar-area'],
  10: ['series-partial-sums', 'taylor-series'],
};

export function explorersFor(unit, skillId = '') {
  const ids = [];
  for (const [re, id] of KEYWORD_MAP) {
    if (re.test(skillId) && !ids.includes(id)) ids.push(id);
  }
  for (const id of UNIT_DEFAULTS[unit?.number] || []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function explorerTitle(id) { return EXPLORERS[id]?.title || id; }

export function mountExplorer(container, id) {
  const def = EXPLORERS[id];
  if (!def) return false;
  const box = el('div', 'viz-box-outer');
  box.innerHTML = `<h3 class="viz-title">${def.title}</h3>
    <div class="viz-graph"></div>
    <div class="viz-controls"></div>
    <div class="viz-readout-wrap"></div>`;
  container.appendChild(box);
  def.build({
    graph: box.querySelector('.viz-graph'),
    controls: box.querySelector('.viz-controls'),
    readout: box.querySelector('.viz-readout-wrap'),
  });
  return true;
}
