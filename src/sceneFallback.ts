import type { Sim2D } from './sim2d';
import { NX, NY, SCENE_H, Surface, XV, YV, zMaxMeters, type SceneInfo, type SceneOpts, type Viewer } from './scene3d';

/** Низ «стены» под гребнями, единицах сцены (впадины уходят в минус) */
const FLOOR = -1.3;
/** шаг по x при отрисовке: 641 точка не нужны, достаточно ~320 */
const STEP = 2;
const FOV = (40 * Math.PI) / 180;

/**
 * Запасной режим без WebGL (отключено аппаратное ускорение): та же поверхность, но «рядами» на canvas 2D
 * с алгоритмом художника. Вращение мышью ограничено, чтобы ряды вдоль x всегда шли от дальнего к ближнему.
 */
export class SceneFallback implements Viewer {
  info: SceneInfo = { exaggeration: 1, carrierClamped: false, waveCount: 0 };
  private surface = new Surface();
  private g: CanvasRenderingContext2D;
  private az = -0.53;
  private el = 0.5;
  private dist = 34;
  private target = [0, 0.3, 0];
  private opts: SceneOpts | null = null;
  private ro: ResizeObserver;
  private drag: { x: number; y: number } | null = null;
  private px = new Float64Array(NX * 4);
  private py = new Float64Array(NX * 4);
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    const down = (e: PointerEvent) => { this.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!this.drag) return;
      this.az = Math.min(1.1, Math.max(-1.1, this.az - (e.clientX - this.drag.x) * 0.006));
      this.el = Math.min(1.4, Math.max(0.15, this.el + (e.clientY - this.drag.y) * 0.006));
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    };
    const up = () => { this.drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.dist = Math.min(80, Math.max(15, this.dist * Math.exp(e.deltaY * 0.001)));
      this.draw();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
  }

  dispose() { this.ro.disconnect(); this.cleanup.forEach((f) => f()); }

  update(sim: Sim2D, o: SceneOpts) {
    this.surface.fill(sim, o);
    this.info = this.surface.info;
    this.opts = o;
    this.draw();
  }

  private draw() {
    const o = this.opts, c = this.canvas, g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    if (!o) return;

    // камера на сфере вокруг цели: az от оси +z, el над горизонтом
    const [tx, ty, tz] = this.target;
    const cx = tx + this.dist * Math.cos(this.el) * Math.sin(this.az);
    const cy = ty + this.dist * Math.sin(this.el);
    const cz = tz + this.dist * Math.cos(this.el) * Math.cos(this.az);
    let fx = tx - cx, fy = ty - cy, fz = tz - cz;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    // right = f × up(0,1,0)
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
    // up = r × f
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const F = H / 2 / Math.tan(FOV / 2);
    const proj = (x: number, y: number, z: number, out: Float64Array, k: number) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d = dx * fx + dy * fy + dz * fz;
      out[2 * k] = W / 2 + (F * (dx * rx + dy * ry + dz * rz)) / d;
      out[2 * k + 1] = H / 2 - (F * (dx * ux + dy * uy + dz * uz)) / d;
    };
    const pt = new Float64Array(2);
    const line = (a: number[], b: number[]) => {
      proj(a[0], a[1], a[2], pt, 0); g.moveTo(pt[0], pt[1]);
      proj(b[0], b[1], b[2], pt, 0); g.lineTo(pt[0], pt[1]);
    };

    const thr = o.threshold;
    const thrH = o.threshold * o.a0 * (SCENE_H / zMaxMeters(o.a0, o.threshold));
    const { h, amp } = this.surface;
    const dx = (2 * XV) / (NX - 1);

    // ряды от дальнего к ближнему: дальний — с большей глубиной
    const rows: number[] = [];
    for (let j = 0; j < NY; j++) rows.push(j);
    const depth = (j: number) => {
      const z = -YV + (j * 2 * YV) / (NY - 1);
      return (0 - cx) * fx + (0 - cy) * fy + (z - cz) * fz;
    };
    rows.sort((a, b) => depth(b) - depth(a));

    g.lineJoin = 'round';
    for (const j of rows) {
      const z = -YV + (j * 2 * YV) / (NY - 1);
      let n = 0;
      for (let i = 0; i < NX; i += STEP, n++) proj(-XV + i * dx, h[j * NX + i], z, this.px, n);
      // нижняя кромка стены (в обратном порядке)
      let m = n;
      for (let i = Math.floor((NX - 1) / STEP) * STEP; i >= 0; i -= STEP, m++) proj(-XV + i * dx, FLOOR, z, this.px, m);
      g.beginPath();
      g.moveTo(this.px[0], this.px[1]);
      for (let k = 1; k < m; k++) g.lineTo(this.px[2 * k], this.px[2 * k + 1]);
      g.closePath();
      g.fillStyle = '#d5dde4';
      g.fill();
      // верхняя кромка: участки выше порога красные
      let red = false;
      g.beginPath();
      g.strokeStyle = '#34414c';
      g.lineWidth = 1;
      let started = false;
      const flush = () => { g.stroke(); g.beginPath(); started = false; };
      for (let k = 0, i = 0; k < n; k++, i += STEP) {
        const r = amp[j * NX + i] >= thr;
        if (k > 0 && r !== red) {
          g.lineTo(this.px[2 * k], this.px[2 * k + 1]);
          flush();
          g.strokeStyle = r ? '#e00000' : '#34414c';
          g.lineWidth = r ? 1.6 : 1;
          g.moveTo(this.px[2 * k], this.px[2 * k + 1]);
          started = true;
        } else if (!started) {
          g.moveTo(this.px[2 * k], this.px[2 * k + 1]);
          started = true;
        } else {
          g.lineTo(this.px[2 * k], this.px[2 * k + 1]);
        }
        red = r;
      }
      g.stroke();
    }

    // порог: красный контур плоскости, рамка области
    g.beginPath();
    g.strokeStyle = 'rgba(224,0,0,0.6)';
    g.setLineDash([6, 4]);
    const q = (x: number, y: number, z: number) => [x, y, z];
    line(q(-XV, thrH, -YV), q(XV, thrH, -YV)); line(q(XV, thrH, -YV), q(XV, thrH, YV));
    line(q(XV, thrH, YV), q(-XV, thrH, YV)); line(q(-XV, thrH, YV), q(-XV, thrH, -YV));
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    for (const y of [FLOOR, SCENE_H]) {
      line(q(-XV, y, -YV), q(XV, y, -YV)); line(q(XV, y, -YV), q(XV, y, YV));
      line(q(XV, y, YV), q(-XV, y, YV)); line(q(-XV, y, YV), q(-XV, y, -YV));
    }
    for (const x of [-XV, XV]) for (const z of [-YV, YV]) line(q(x, FLOOR, z), q(x, SCENE_H, z));
    g.stroke();
    g.fillStyle = '#555';
    g.font = '11px ui-monospace, Menlo, Consolas, monospace';
    g.fillText('режим без WebGL: ряды вдоль x · перетаскивание — поворот, колесо — масштаб', 8, H - 8);
  }
}
