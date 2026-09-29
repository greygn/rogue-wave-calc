import type { Sim } from './simulation';

export interface DrawOpts {
  Hs: number;
  threshold: number;
  viewHalf: number | null;
}

const INK = '#000';
const GRID = '#c8c8c8';
const RED = '#e00000';
const FONT = '11px ui-monospace, Menlo, Consolas, monospace';

export function draw(canvas: HTMLCanvasElement, sim: Sim, o: DrawOpts) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, cssW, cssH);

  const ml = 44, mr = 12, mt = 12, mb = 26;
  const pw = cssW - ml - mr, ph = cssH - mt - mb;
  const yMax = 3.4 * o.Hs;
  const yPix = (v: number) => mt + ph - (Math.min(v, yMax) / yMax) * ph;
  const cell = 6;

  g.fillStyle = GRID;
  for (let px = 0; px <= pw; px += cell * 4)
    for (let py = 0; py <= ph; py += cell * 4) g.fillRect(ml + px - 0.5, mt + py - 0.5, 1, 1);

  // visible index range
  const half = o.viewHalf ?? sim.L / 2;
  const dx = sim.L / sim.N;
  const j0 = Math.max(0, Math.floor((sim.L / 2 - half) / dx));
  const j1 = Math.min(sim.N, Math.ceil((sim.L / 2 + half) / dx));
  const cols = Math.max(1, Math.floor(pw / cell));

  // threshold line
  const yThr = yPix(o.threshold * o.Hs);
  g.fillStyle = INK;
  for (let px = 0; px <= pw; px += 8) g.fillRect(ml + px, yThr, 3, 1);
  g.font = FONT;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.fillText('AI=' + o.threshold.toFixed(1), ml - 4, yThr);
  for (const m of [0, 1, 2, 3]) {
    if (Math.abs(m - o.threshold) < 0.35) continue;
    g.fillText(m === 0 ? '0' : m + 'Hs', ml - 4, yPix(m * o.Hs));
  }

  // profile: columns of dots up to |psi|
  for (let c = 0; c < cols; c++) {
    const a = j0 + Math.floor(((j1 - j0) * c) / cols);
    const b = Math.max(a + 1, j0 + Math.floor(((j1 - j0) * (c + 1)) / cols));
    let v = 0;
    for (let j = a; j < b && j < sim.N; j++) v = Math.max(v, Math.hypot(sim.re[j], sim.im[j]));
    const rogue = v / o.Hs >= o.threshold;
    g.fillStyle = rogue ? RED : INK;
    const x = ml + c * cell + cell / 2;
    const top = yPix(v);
    for (let y = mt + ph; y > top + 2; y -= cell) g.fillRect(x - 1, y - 1, 2, 2);
    g.beginPath();
    g.arc(x, top, 2.2, 0, 2 * Math.PI);
    g.fill();
  }

  // axes
  g.fillStyle = INK;
  g.fillRect(ml, mt + ph + 4, pw, 1);
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillText('x=' + (-half).toFixed(1), ml, mt + ph + 9);
  g.textAlign = 'center';
  g.fillText('0', ml + pw / 2, mt + ph + 9);
  g.textAlign = 'right';
  g.fillText(half.toFixed(1), ml + pw, mt + ph + 9);
}
