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

export function initPeregrine(A0: number): Sim {
  const sim = new Sim(1024, peregrineDomain(A0), 0.004 / (A0 * A0));
  fillPeregrine(sim, -PEREGRINE_T0 / (A0 * A0), A0);
  return sim;
}
