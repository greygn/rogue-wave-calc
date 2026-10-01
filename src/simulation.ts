import { makeFFT, type FFT } from './fft';

/** Split-step Fourier (Strang) for i psi_t + 1/2 psi_xx + |psi|^2 psi = 0 on a periodic grid. */
export class Sim {
  readonly N: number;
  readonly L: number;
  readonly dt: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  t = 0;
  private fft: FFT;
  private cr: Float64Array;
  private ci: Float64Array;

  constructor(N: number, L: number, dt: number) {
    this.N = N; this.L = L; this.dt = dt;
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.fft = makeFFT(N);
    this.cr = new Float64Array(N);
    this.ci = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const k = ((2 * Math.PI) / L) * (j <= N / 2 ? j : j - N);
      const ph = (k * k * dt) / 4;
      this.cr[j] = Math.cos(ph);
      this.ci[j] = -Math.sin(ph);
    }
  }

  /** x_j = -L/2 + j*L/N */
  x(j: number): number { return -this.L / 2 + (j * this.L) / this.N; }

  private linear() {
    const { re, im, cr, ci, N } = this;
    this.fft(re, im, false);
    for (let j = 0; j < N; j++) {
      const a = re[j], b = im[j];
      re[j] = a * cr[j] - b * ci[j];
      im[j] = a * ci[j] + b * cr[j];
    }
    this.fft(re, im, true);
  }

  step() {
    const { re, im, N, dt } = this;
    this.linear();
    for (let j = 0; j < N; j++) {
      const p = (re[j] * re[j] + im[j] * im[j]) * dt;
      const c = Math.cos(p), s = Math.sin(p);
      const a = re[j], b = im[j];
      re[j] = a * c - b * s;
      im[j] = a * s + b * c;
    }
    this.linear();
    this.t += dt;
  }

  maxAmp(): number {
    let m = 0;
    for (let j = 0; j < this.N; j++) {
      const a = this.re[j] * this.re[j] + this.im[j] * this.im[j];
      if (a > m) m = a;
    }
    return Math.sqrt(m);
  }
}

/** Benjamin-Feir growth rate squared, generalised for background A0: k^2 (A0^2 - k^2/4). A0=1 gives k^2 (1 - k^2/4). */
export function bfLambda2(k: number, A0 = 1): number {
  return k * k * (A0 * A0 - (k * k) / 4);
}

export const N_GRID = 512;
export const DT = 0.004;

/** Domain length: integer number of perturbation periods so cos(kx) is periodic. */
export function domainLength(k: number, target = 40): number {
  const m = Math.max(1, Math.round((k * target) / (2 * Math.PI)));
  return (2 * Math.PI * m) / k;
}

/**
 * Фон A0 + возмущение cos(kx). При localized=true возмущение умножается на гауссово окно (σ = π/2k)
 * в центре области: растёт одна волна-убийца, остальная область остаётся фоновым волнением.
 */
export function initPerturbed(A0: number, eps: number, k: number, localized = true): Sim {
  const sim = new Sim(N_GRID, domainLength(k), DT);
  const sigma = Math.PI / (2 * k);
  for (let j = 0; j < sim.N; j++) {
    const x = sim.x(j);
    const w = localized ? Math.exp(-(x * x) / (2 * sigma * sigma)) : 1;
    sim.re[j] = A0 * (1 + eps * w * Math.cos(k * x));
    sim.im[j] = 0;
  }
  return sim;
}
