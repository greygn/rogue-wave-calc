import { describe, expect, it } from 'vitest';
import { SEA2D_T_END, Sea2D } from './sim2d';

describe('2D sea with rogue wave', () => {
  it('flat-ish random background, one rogue structure by the end of the scenario', () => {
    const s = new Sea2D();
    let early = 0;
    let max = 0;
    while (s.t < SEA2D_T_END - 1e-9) {
      s.step();
      max = Math.max(max, s.maxAmp());
      if (s.t < 1.5) early = Math.max(early, s.maxAmp());
    }
    expect(early).toBeLessThan(1.5); // обычные волны без пиков
    expect(max).toBeGreaterThan(2.8); // вырастает волна-убийца
    expect(max).toBeLessThan(3.6);
  });

  it('snapshot/restore reproduces the same state', () => {
    const s = new Sea2D();
    for (let i = 0; i < 5; i++) s.step();
    const snap = s.snapshot();
    for (let i = 0; i < 5; i++) s.step();
    const a = s.maxAmp();
    s.restore(snap);
    for (let i = 0; i < 5; i++) s.step();
    expect(s.maxAmp()).toBe(a);
  });
});
