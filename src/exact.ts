import { Sim } from './simulation';

export function peregrine(x: number, t: number): [number, number] {
  const D = 1 + 4 * x * x + 4 * t * t;
  const fr = 1 - 4 / D;
  const fi = -(8 * t) / D;
  const c = Math.cos(t), s = Math.sin(t);
  return [fr * c - fi * s, fr * s + fi * c];
}

export function peregrineScaled(x: number, t: number, A0: number): [number, number] {
  const [a, b] = peregrine(A0 * x, A0 * A0 * t);
  return [A0 * a, A0 * b];
}

export const PEREGRINE_T0 = 3;

export function peregrineDomain(A0: number): number { return 100 / A0; }

export function fillPeregrine(sim: Sim, t: number, A0: number) {
  for (let j = 0; j < sim.N; j++) {
    const [a, b] = peregrineScaled(sim.x(j), t, A0);
    sim.re[j] = a; sim.im[j] = b;
  }
  sim.t = t;
}

/**
 * Sim, у которого шаг по времени — это подстановка точного решения Перегрина (пик при t = T0/A0²).
 * Численная схема здесь не нужна: в ней ошибки округления за десятки единиц времени вырастают
 * по модуляционной неустойчивости в побочные всплески, а у точного решения волна одна.
 */
export class PeregrineSim extends Sim {
  private readonly A0: number;
  constructor(A0: number) {
    super(1024, peregrineDomain(A0), 0.004 / (A0 * A0));
    this.A0 = A0;
    this.t = 0;
    this.fillAt();
  }
  private fillAt() {
    const t = this.t;
    fillPeregrine(this, t - PEREGRINE_T0 / (this.A0 * this.A0), this.A0);
    this.t = t;
  }
  override step() {
    this.t += this.dt;
    this.fillAt();
  }
}

export function initPeregrine(A0: number): Sim {
  const sim = new Sim(1024, peregrineDomain(A0), 0.004 / (A0 * A0));
  fillPeregrine(sim, -PEREGRINE_T0 / (A0 * A0), A0);
  return sim;
}

/** Детерминированный ГПСЧ (mulberry32): один и тот же фон при каждом сбросе и откате. */
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

/** фоновые волны берём в устойчивой полосе k > 2·A0 (вне неустойчивости Бенджамина—Фейра): они не растут сами */
const KB_LO = 2.4, KB_HI = 5;
/** конец сценария (в единицах 1/A0²): позже пик Перегрина и шум запускают модуляционную неустойчивость, и фон превращается в хаос */
export const SEA_T_END = 5.5;

/**
 * Волна-убийца среди обычных волн: фон A0 со случайными небольшими волнами (шум в устойчивой полосе k > 2·A0,
 * высота волн случайна) плюс зародыш Перегрина в центре. Дальше считает численная схема: в центре зародыш
 * вырастает в волну-убийцу, а фон остаётся рядом обычных волн. Сценарий идёт до SEA_T_END.
 */
export class SeaWithRogueSim extends Sim {
  constructor(A0: number, eps = 0.05, seed = 7) {
    super(1024, peregrineDomain(A0), 0.004 / (A0 * A0));
    fillPeregrine(this, -PEREGRINE_T0 / (A0 * A0), A0);
    this.t = 0;
    const rnd = rng(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const mMin = Math.ceil((KB_LO * A0 * this.L) / (2 * Math.PI));
    const mMax = Math.floor((KB_HI * A0 * this.L) / (2 * Math.PI));
    const n = 2 * (mMax - mMin + 1);
    const amp = (eps * A0) / Math.sqrt(n);
    for (let m = -mMax; m <= mMax; m++) {
      if (Math.abs(m) < mMin) continue;
      const k = (2 * Math.PI * m) / this.L;
      const cr = amp * gauss(), ci = amp * gauss();
      for (let j = 0; j < this.N; j++) {
        const c = Math.cos(k * this.x(j)), s = Math.sin(k * this.x(j));
        this.re[j] += cr * c - ci * s;
        this.im[j] += cr * s + ci * c;
      }
    }
  }
}
