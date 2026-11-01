// SVG rendering: rotary knobs, envelope graphs and the seven-segment LED.
(function () {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(svgNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------------------------------------------------------------- knob
  // A knob turns through 270 degrees, from -135 (min) to +135 (max).
  const A0 = -135, A1 = 135, R = 15, C = 20;
  const polar = (deg, r = R) => {
    const a = (deg - 90) * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  function arc(d0, d1, r = R) {
    if (Math.abs(d1 - d0) < 0.01) return '';
    const [x0, y0] = polar(Math.min(d0, d1), r), [x1, y1] = polar(Math.max(d0, d1), r);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  function createKnob(svg) {
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.appendChild(el('path', { class: 'k-track', d: arc(A0, A1) }));
    const value = el('path', { class: 'k-value' });
    svg.appendChild(value);
    svg.appendChild(el('circle', { class: 'k-cap', cx: C, cy: C, r: 11 }));
    const ptr = el('line', { class: 'k-ptr', x1: C, y1: C - 4, x2: C, y2: C - 10.5 });
    svg.appendChild(ptr);
    return { value, ptr };
  }
  // frac: 0..1 position; from: 0..1 origin of the value arc (0.5-ish for bipolar)
  function updateKnob(k, frac, from = 0) {
    const deg = A0 + (A1 - A0) * frac;
    const deg0 = A0 + (A1 - A0) * from;
    k.value.setAttribute('d', arc(deg0, deg));
    k.ptr.setAttribute('transform', `rotate(${deg.toFixed(1)} ${C} ${C})`);
  }

  // ---------------------------------------------------------------- envelopes
  // Envelope graphs drawn from the timing model measured on the hardware
  // (js/envmodel.js): a real, linear time axis per graph, the measured shapes,
  // and the stage times printed under the curve.
  const MODEL = window.AN_ENV_MODEL;
  const LN100 = Math.log(100);
  const tauOf = v => MODEL.tau[Math.max(0, Math.min(127, v))];
  const interpTable = (tbl, v) => {                      // { "0": y, "8": y, ... } -> y at v
    const ks = Object.keys(tbl).map(Number).sort((a, b) => a - b);
    if (v <= ks[0]) return tbl[ks[0]];
    for (let i = 1; i < ks.length; i++) {
      if (v <= ks[i]) {
        const f = (v - ks[i - 1]) / (ks[i] - ks[i - 1]);
        return tbl[ks[i - 1]] + (tbl[ks[i]] - tbl[ks[i - 1]]) * f;
      }
    }
    return tbl[ks[ks.length - 1]];
  };
  const shapeAt = (shape, x) => {                        // shape: progress at 0, 1/n ... 1
    const n = shape.length - 1, p = Math.max(0, Math.min(1, x)) * n, i = Math.min(n - 1, Math.floor(p));
    return shape[i] + (shape[i + 1] - shape[i]) * (p - i);
  };
  // Stage times in seconds. Attacks: time to full level (to the peak for PEG/FEG);
  // decays and releases: time to cover 99 % of the way (-40 dB for the AEG).
  // attack = start delay (FEG ~12 ms after the sound) + rise of k * tau
  const attackTime = (kind, v) => {
    const a = MODEL[kind + 'Attack'];
    return (a.delay || 0) + a.k * tauOf(v);
  };
  const fallTime = v => tauOf(v) * LN100;
  const aegAttackShape = x => (1 - Math.exp(-x / MODEL.aegAttack.rc)) / (1 - Math.exp(-1 / MODEL.aegAttack.rc));
  const aegSustainAmp = s => (s <= 0 ? 0 : Math.pow(10, interpTable(MODEL.aegSustainDb, s) / 20));
  const aegSustainDb = s => interpTable(MODEL.aegSustainDb, s);
  const fegSustainFrac = s => interpTable(MODEL.fegSustain, s);

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec)) return '∞';
    const ms = sec * 1000;
    if (ms < 100) return ms.toFixed(1) + ' ms';      // one decimal, so small steps stay visible
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (sec < 10) return sec.toFixed(2) + ' s';
    return sec.toFixed(1) + ' s';
  }

  // Builds the graph box once: <div class="eg-box"><svg/><div class="eg-times"/></div>
  function createEnvelope(parent) {
    const box = document.createElement('div');
    box.className = 'eg-box';
    const svg = el('svg', { class: 'eg' });
    const times = document.createElement('div');
    times.className = 'eg-times';
    box.append(svg, times);
    parent.appendChild(box);
    return { box, svg, times };
  }

  // segments: [{ dur, f: x(0..1) -> y, label }]; y range [ymin, ymax]; zero: y of the baseline
  function renderEnvelope(g, segments, { ymin = 0, ymax = 1, zero = 0, title }) {
    const W = 400, H = 60, pad = 3;
    const svg = g.svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = '';
    const total = segments.reduce((a, s) => a + s.dur, 0) || 1;
    const X = t => (t / total) * W;
    const Y = y => H - pad - ((y - ymin) / (ymax - ymin || 1)) * (H - 2 * pad);
    const pts = [];
    let t0 = 0;
    segments.forEach((sg, i) => {
      const n = Math.max(2, Math.round(160 * sg.dur / total));
      for (let k = 0; k <= n; k++) pts.push([X(t0 + sg.dur * k / n), Y(sg.f(k / n))]);
      t0 += sg.dur;
      if (i < segments.length - 1) svg.appendChild(el('line', { class: 'eg-div', x1: X(t0), y1: 0, x2: X(t0), y2: H }));
    });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    svg.insertBefore(el('line', { class: 'eg-axis', x1: 0, y1: Y(zero), x2: W, y2: Y(zero) }), svg.firstChild);
    svg.appendChild(el('path', { class: 'eg-fill', d: `${line} L${W} ${Y(zero)} L0 ${Y(zero)} Z` }));
    svg.appendChild(el('path', { class: 'eg-line', d: line }));
    g.times.innerHTML = '';
    for (const sg of segments) {
      if (!sg.label) continue;
      const sp = document.createElement('span');
      sp.textContent = sg.label;
      g.times.appendChild(sp);
    }
    g.box.title = title;
  }

  const TIMES_NOTE = 'Times measured on the hardware: attack = time to the peak, decay/release = time to cover 99 % of the way (-40 dB for the AEG). The time axis is linear; the sustain section has an arbitrary length.';

  // AEG: amplitude (linear) over time
  function drawAeg(g, a, d, s, r) {
    const ta = attackTime('aeg', a);
    const As = aegSustainAmp(s);
    const td = As >= 0.999 ? 0 : fallTime(d), tr = fallTime(r);
    const tauD = tauOf(d), tauR = tauOf(r);
    const hold = Math.max(0.25 * (ta + td + tr), 1e-4);
    renderEnvelope(g, [
      { dur: ta, f: x => aegAttackShape(x), label: `A ${fmtTime(ta)}` },
      { dur: td, f: x => As + (1 - As) * Math.exp(-x * td / tauD), label: td ? `D ${fmtTime(td)}` : 'D –' },
      { dur: hold, f: () => As, label: `S ${s ? aegSustainDb(s).toFixed(1) + ' dB' : '−∞ dB'}` },
      { dur: tr, f: x => As * Math.exp(-x * tr / tauR), label: `R ${fmtTime(tr)}` },
    ], { title: TIMES_NOTE });
  }

  // FEG: cutoff offset as a fraction of the FEG depth (inverted for negative depths)
  function drawFeg(g, a, d, s, r, depthSign) {
    const ta = attackTime('feg', a), fd = MODEL.fegAttack.delay || 0;   // flat during the start delay
    const Fs = fegSustainFrac(s);
    const td = Fs >= 0.999 ? 0 : fallTime(d), tr = fallTime(r);
    const tauD = tauOf(d), tauR = tauOf(r);
    const hold = Math.max(0.25 * (ta + td + tr), 1e-4);
    const sg = depthSign < 0 ? -1 : 1;
    renderEnvelope(g, [
      { dur: ta, f: x => sg * shapeAt(MODEL.fegAttack.shape, Math.max(0, (x * ta - fd) / (ta - fd))), label: `A ${fmtTime(ta)}` },
      { dur: td, f: x => sg * (Fs + (1 - Fs) * Math.exp(-x * td / tauD)), label: td ? `D ${fmtTime(td)}` : 'D –' },
      { dur: hold, f: () => sg * Fs, label: `S ${Math.round(Fs * 100)}%` },
      { dur: tr, f: x => sg * Fs * Math.exp(-x * tr / tauR), label: `R ${fmtTime(tr)}` },
    ], sg < 0 ? { ymin: -1, ymax: 0, zero: 0, title: TIMES_NOTE } : { title: TIMES_NOTE });
  }

  // PEG: pitch offset (semitones). Decay 127 holds the depth; the attack then
  // approaches it exponentially (measured), otherwise it is a near-linear rise.
  function drawPeg(g, attack, decay, depth) {
    const span = Math.max(Math.abs(depth), 1);
    const hold = decay >= 127;
    let segs;
    if (hold) {
      const ta = fallTime(attack), tauA = tauOf(attack);
      segs = [
        { dur: ta, f: x => depth * (1 - Math.exp(-x * ta / tauA)), label: `A ${fmtTime(ta)}` },
        { dur: ta * 0.5 + 1e-4, f: () => depth, label: 'D hold' },
      ];
    } else {
      const ta = attackTime('peg', attack), td = fallTime(decay), tauD = tauOf(decay);
      segs = [
        { dur: ta, f: x => depth * shapeAt(MODEL.pegAttack.shape, x), label: `A ${fmtTime(ta)}` },
        { dur: td, f: x => depth * Math.exp(-x * td / tauD), label: `D ${fmtTime(td)}` },
        { dur: 0.15 * (ta + td), f: () => 0, label: '' },
      ];
    }
    segs.push({ dur: 0, f: () => 0, label: `${depth > 0 ? '+' : ''}${depth} st` });
    renderEnvelope(g, segs.filter(x => x.dur > 0 || x.label),
      { ymin: -span * 1.1, ymax: span * 1.1, zero: 0, title: TIMES_NOTE });
  }

  // "1.23 s"-style time of a rate parameter, for tooltips and the LCD
  const rateTime = (key, v) => ({
    aegA: () => fmtTime(attackTime('aeg', v)), fegA: () => fmtTime(attackTime('feg', v)),
    pegAttack: () => fmtTime(attackTime('peg', v)),
    aegD: () => fmtTime(fallTime(v)), aegR: () => fmtTime(fallTime(v)),
    fegD: () => fmtTime(fallTime(v)), fegR: () => fmtTime(fallTime(v)),
    pegDecay: () => (v >= 127 ? 'hold' : fmtTime(fallTime(v))),
  }[key] || (() => null))();

  // ---------------------------------------------------------------- seven-segment LED
  const SEGMENTS = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
    5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
  };
  const DW = 20, DH = 36, T = 3.6, PITCH = 27;

  function segmentPoints(seg) {
    const hx = (y, x1 = 2, x2 = DW - 2) =>
      [[x1 + T / 2 + 0.6, y], [x1 + T + 0.6, y - T / 2], [x2 - T - 0.6, y - T / 2],
        [x2 - T / 2 - 0.6, y], [x2 - T - 0.6, y + T / 2], [x1 + T + 0.6, y + T / 2]];
    const vx = (x, y1, y2) =>
      [[x, y1 + T / 2 + 0.6], [x + T / 2, y1 + T + 0.6], [x + T / 2, y2 - T - 0.6],
        [x, y2 - T / 2 - 0.6], [x - T / 2, y2 - T - 0.6], [x - T / 2, y1 + T + 0.6]];
    const mid = DH / 2;
    const pts = {
      a: hx(2), g: hx(mid), d: hx(DH - 2),
      f: vx(2, 2, mid), b: vx(DW - 2, 2, mid),
      e: vx(2, mid, DH - 2), c: vx(DW - 2, mid, DH - 2),
    }[seg];
    return pts.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  }

  // dot lights the decimal point after the last digit ("edited").
  function drawSevenSegment(svg, text, dot) {
    const n = text.length;
    svg.innerHTML = '';
    const vbW = (n - 1) * PITCH + DW + 10;
    svg.setAttribute('viewBox', `-3 -1 ${vbW} ${DH + 2}`);
    svg.style.aspectRatio = `${vbW} / ${DH + 2}`;
    const g = el('g', { transform: 'skewX(-6)', 'transform-origin': `0 ${DH}` });
    [...text].forEach((ch, i) => {
      const lit = SEGMENTS[ch] ?? '';
      const digit = el('g', { transform: `translate(${i * PITCH} 0)` });
      for (const seg of 'abcdefg') {
        digit.appendChild(el('polygon', { points: segmentPoints(seg), class: lit.includes(seg) ? 'seg on' : 'seg' }));
      }
      g.appendChild(digit);
    });
    g.appendChild(el('circle', { cx: (n - 1) * PITCH + DW + 3, cy: DH - 2, r: 2.2, class: dot ? 'seg on' : 'seg' }));
    svg.appendChild(g);
  }

  window.Graphics = { el, createKnob, updateKnob, createEnvelope, drawAeg, drawFeg, drawPeg, rateTime, fmtTime, drawSevenSegment };
})();
