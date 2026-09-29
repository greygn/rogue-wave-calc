import { describe, expect, it } from 'vitest';
import { Sim, bfLambda2, initPerturbed } from './simulation';
import { fillPeregrine, peregrineDomain } from './exact';

describe('SSFM vs Peregrine', () => {
  it('reproduces analytic solution at t=0 and t=+t0', () => {
    const A0 = 1;
    const T0 = 3;
    const sim = new Sim(1024, peregrineDomain(A0), 0.002);
    fillPeregrine(sim, -T0, A0);
    const ref = new Sim(1024, peregrineDomain(A0), 0.002);
    for (const target of [0, T0]) {
      while (sim.t < target - 1e-9) sim.step();
      fillPeregrine(ref, target, A0);
      let err = 0;
      for (let j = 0; j < sim.N; j++) err = Math.max(err, Math.hypot(sim.re[j] - ref.re[j], sim.im[j] - ref.im[j]));
      expect(err).toBeLessThan(0.02);
      if (target === 0) expect(Math.abs(sim.maxAmp() - 3)).toBeLessThan(0.05);
    }
  });
});

describe('Benjamin-Feir linear growth', () => {
  it('matches cosh(lambda t)', () => {
    const A0 = 1, k = 1, eps = 1e-4;
    const sim = initPerturbed(A0, eps, k);
    const T = 1.5;
    while (sim.t < T - 1e-9) sim.step();
    const c = Math.cos(A0 * A0 * sim.t), s = Math.sin(A0 * A0 * sim.t);
    let u = 0;
    for (let j = 0; j < sim.N; j++) {
      const r = sim.re[j] * c + sim.im[j] * s;
      u += (r - A0) * Math.cos(k * sim.x(j));
    }
    u *= 2 / sim.N;
    const lam = Math.sqrt(bfLambda2(k, A0));
    expect(u / (A0 * eps)).toBeCloseTo(Math.cosh(lam * T), 2);
  });
});
