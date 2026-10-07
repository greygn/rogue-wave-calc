import { makeFFT, type FFT } from './fft';
import { peregrineScaled } from './exact';

/**
 * 2D НУШ для глубокой воды (гиперболическое приближение, Eliasson & Shukla 2010):
 *   i ψ_t + ½ ψ_xx − ψ_yy + |ψ|² ψ = 0,
 * x — направление распространения несущей, y — вдоль гребня. Масштаб L тот же, что и в 1D.
 * Схема: симметризованное расщепление N(dt/2) L(dt) N(dt/2), периодические границы.
 */
export class Sim2D {
  readonly Nx: number;
  readonly Ny: number;
  readonly Lx: number;
  readonly Ly: number;
  readonly dt: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  t = 0;
  private fftX: FFT;
  private fftY: FFT;
  private phC: Float64Array;
  private phS: Float64Array;
  private tr: Float64Array;
  private ti: Float64Array;

  constructor(Nx: number, Ny: number, Lx: number, Ly: number, dt: number) {
    this.Nx = Nx; this.Ny = Ny; this.Lx = Lx; this.Ly = Ly; this.dt = dt;
    const n = Nx * Ny;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.fftX = makeFFT(Nx);
    this.fftY = makeFFT(Ny);
    this.tr = new Float64Array(Math.max(Nx, Ny));
    this.ti = new Float64Array(Math.max(Nx, Ny));
    this.phC = new Float64Array(n);
    this.phS = new Float64Array(n);
    for (let iy = 0; iy < Ny; iy++) {
      const ky = ((2 * Math.PI) / Ly) * (iy <= Ny / 2 ? iy : iy - Ny);
      for (let ix = 0; ix < Nx; ix++) {
        const kx = ((2 * Math.PI) / Lx) * (ix <= Nx / 2 ? ix : ix - Nx);
        const ph = (0.5 * kx * kx - ky * ky) * dt;
        this.phC[iy * Nx + ix] = Math.cos(ph);
        this.phS[iy * Nx + ix] = -Math.sin(ph);
      }
    }
  }

  x(i: number): number { return -this.Lx / 2 + (i * this.Lx) / this.Nx; }
  y(i: number): number { return -this.Ly / 2 + (i * this.Ly) / this.Ny; }

  private fft2(inverse: boolean) {
    const { re, im, Nx, Ny, tr, ti } = this;
    for (let iy = 0; iy < Ny; iy++) {
      const o = iy * Nx;
      for (let ix = 0; ix < Nx; ix++) { tr[ix] = re[o + ix]; ti[ix] = im[o + ix]; }
      this.fftX(tr.subarray(0, Nx), ti.subarray(0, Nx), inverse);
      for (let ix = 0; ix < Nx; ix++) { re[o + ix] = tr[ix]; im[o + ix] = ti[ix]; }
    }
    for (let ix = 0; ix < Nx; ix++) {
      for (let iy = 0; iy < Ny; iy++) { tr[iy] = re[iy * Nx + ix]; ti[iy] = im[iy * Nx + ix]; }
      this.fftY(tr.subarray(0, Ny), ti.subarray(0, Ny), inverse);
      for (let iy = 0; iy < Ny; iy++) { re[iy * Nx + ix] = tr[iy]; im[iy * Nx + ix] = ti[iy]; }
    }
  }

  private nonlinear(h: number) {
    const { re, im } = this;
    for (let j = 0; j < re.length; j++) {
      const p = (re[j] * re[j] + im[j] * im[j]) * h;
      const c = Math.cos(p), s = Math.sin(p);
      const a = re[j], b = im[j];
      re[j] = a * c - b * s;
      im[j] = a * s + b * c;
    }
  }

  step() {
    const { re, im, phC, phS } = this;
    this.nonlinear(this.dt / 2);
    this.fft2(false);
    for (let j = 0; j < re.length; j++) {
      const a = re[j], b = im[j];
      re[j] = a * phC[j] - b * phS[j];
      im[j] = a * phS[j] + b * phC[j];
    }
    this.fft2(true);
    this.nonlinear(this.dt / 2);
    this.t += this.dt;
  }

  maxAmp(): number {
    let m = 0;
    for (let j = 0; j < this.re.length; j++) {
      const a = this.re[j] * this.re[j] + this.im[j] * this.im[j];
      if (a > m) m = a;
    }
    return Math.sqrt(m);
  }

  /** копия состояния для быстрого отката */
  snapshot() { return { t: this.t, re: this.re.slice(), im: this.im.slice() }; }
  restore(s: { t: number; re: Float64Array; im: Float64Array }) {
    this.re.set(s.re); this.im.set(s.im); this.t = s.t;
  }
}

export const T0_2D = 3;
/** ширина зародыша по y (σ гауссиана), безразмерных ед. */
export const SEED_W = 6;
export const SEA2D_T_END = 5;
export const SEA2D_DT = 0.016;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Волна-убийца среди обычных волн в 2D: плоский фон |ψ|=1, случайная рябь из устойчивой области
 * (Λ = kx²/2 − ky² вне (0, 2): инкремент Ω² = Λ(2 − Λ) ≤ 0) и зародыш Перегрина (1983) в центре,
 * умноженный по y на гауссиан.
 */
export class Sea2D extends Sim2D {
  constructor(eps = 0.04, seed = 7, w = SEED_W) {
    super(512, 128, 51.2, 48, SEA2D_DT);
    const rnd = rng(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    // фон e^{iτ} при τ = −T0 плюс отклонение Перегрина от фона, погашенное по y гауссианом
    const bc = Math.cos(-T0_2D), bs = Math.sin(-T0_2D);
    for (let iy = 0; iy < this.Ny; iy++) {
      const y = this.y(iy);
      const g = Math.exp(-(y * y) / (2 * w * w));
      for (let ix = 0; ix < this.Nx; ix++) {
        const [a, b] = peregrineScaled(this.x(ix), -T0_2D, 1);
        const j = iy * this.Nx + ix;
        this.re[j] = bc + (a - bc) * g;
        this.im[j] = bs + (b - bs) * g;
      }
    }
    this.addRipples(eps, rnd, gauss);
  }

  private addRipples(eps: number, rnd: () => number, gauss: () => number) {
    const modes: [number, number][] = [];
    for (let my = -10; my <= 10; my++) {
      for (let mx = 1; mx <= 40; mx++) {
        const kx = (2 * Math.PI * mx) / this.Lx, ky = (2 * Math.PI * my) / this.Ly;
        const lam = 0.5 * kx * kx - ky * ky;
        if ((lam <= -0.3 || lam >= 2.3) && kx < 6 && Math.abs(ky) < 4) modes.push([kx, ky]);
      }
    }
    void rnd;
    const amp = eps / Math.sqrt(2 * modes.length);
    const cx = new Float64Array(this.Nx), sx = new Float64Array(this.Nx);
    const cy = new Float64Array(this.Ny), sy = new Float64Array(this.Ny);
    for (const [kx, ky] of modes) {
      const cr = amp * gauss(), ci = amp * gauss();
      for (let ix = 0; ix < this.Nx; ix++) { cx[ix] = Math.cos(kx * this.x(ix)); sx[ix] = Math.sin(kx * this.x(ix)); }
      for (let iy = 0; iy < this.Ny; iy++) { cy[iy] = Math.cos(ky * this.y(iy)); sy[iy] = Math.sin(ky * this.y(iy)); }
      for (let iy = 0; iy < this.Ny; iy++) {
        for (let ix = 0; ix < this.Nx; ix++) {
          const c = cx[ix] * cy[iy] - sx[ix] * sy[iy], s = sx[ix] * cy[iy] + cx[ix] * sy[iy];
          const j = iy * this.Nx + ix;
          this.re[j] += cr * c - ci * s;
          this.im[j] += cr * s + ci * c;
        }
      }
    }
  }
}
