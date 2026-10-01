/** Перевод безразмерных величин НУШ (iψ_t + ½ψ_xx + |ψ|²ψ = 0, фон |ψ| = 1) в физические. */

const G = 9.81;

export interface Scales {
  /** волновое число несущей, рад/м */
  k0: number;
  /** длина несущей волны, м */
  lambda0: number;
  /** метров на единицу x */
  L: number;
  /** секунд на единицу t */
  T: number;
  /** крутизна несущей k0·a0 */
  steepness: number;
}

/**
 * Глубокая вода: ω0 = 2π/Tp, k0 = ω0²/g. НУШ для огибающей a:
 *   i a_t − (ω0/8k0²) a_xx − (ω0 k0²/2)|a|² a = 0   (в системе, движущейся с c_g).
 * При a = a0·ψ, x = L·X, t = T·τ получаем безразмерную форму с
 *   T = 2 / (ω0 (k0 a0)²),  L = 1 / (√2 k0² a0).
 * Граница неустойчивости k < 2 (при A0 = 1) даёт Δk < 2√2 k0² a0 — классический критерий Бенджамина—Фейра.
 */
export function scales(a0: number, Tp: number): Scales {
  const w0 = (2 * Math.PI) / Tp;
  const k0 = (w0 * w0) / G;
  return {
    k0,
    lambda0: (2 * Math.PI) / k0,
    L: 1 / (Math.SQRT2 * k0 * k0 * a0),
    T: 2 / (w0 * (k0 * a0) ** 2),
    steepness: k0 * a0,
  };
}

export function fmtTime(s: number): string {
  if (s < 120) return s.toFixed(0) + ' с';
  if (s < 7200) return (s / 60).toFixed(1) + ' мин';
  return (s / 3600).toFixed(2) + ' ч';
}
