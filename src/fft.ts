export type FFT = (re: Float64Array, im: Float64Array, inverse: boolean) => void;

export function makeFFT(n: number): FFT {
  if (n & (n - 1)) throw new Error('FFT size must be power of 2');
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  const cs = new Float64Array(n / 2);
  const sn = new Float64Array(n / 2);
  for (let m = 0; m < n / 2; m++) {
    cs[m] = Math.cos((2 * Math.PI * m) / n);
    sn[m] = Math.sin((2 * Math.PI * m) / n);
  }
  return (re, im, inverse) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const wr = cs[j * step];
          const wi = sgn * sn[j * step];
          const a = i + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
}
