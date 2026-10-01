import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tex } from './Tex';
import { draw } from './render';
import { bfLambda2, domainLength, initPerturbed, type Sim } from './simulation';
import { fmtTime, scales } from './physical';

type HL = 'A0' | 'Tp' | 'eps' | 'k' | 'thr' | null;

interface Metrics { t: number; hmax: number; peak: number; }

/** Зафиксированная волна-убийца: эпизод превышения порога AI. */
interface RogueRecord { id: number; t0: number; t: number; hmax: number; ai: number; }

const f = (v: number, d = 2) => v.toFixed(d);

const STEPS_PER_FRAME = 8;

interface ParamProps {
  id: Exclude<HL, null>;
  label: string; unit?: string; min: number; max: number; step: number; value: number;
  /** множитель отображения: в поле показывается value·scale (слайдер остаётся во внутренних единицах) */
  scale?: number;
  onChange: (v: number) => void; hl: HL;
}

function Param({ id, label, unit, min, max, step, value, scale = 1, onChange, hl }: ParamProps) {
  return (
    <div className={'param' + (hl === id ? ' hl' : '')}>
      <label><span>{label}{unit && <span className="unit">, {unit}</span>}</span></label>
      <div className="ctl">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))} />
        <input type="number" min={min * scale} max={max * scale} step={step * scale}
          value={Number((value * scale).toPrecision(4))}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v / scale); }} />
      </div>
    </div>
  );
}

interface LegendItem { sym: string; text: string; hl?: Exclude<HL, null>; }

const LEGEND: LegendItem[] = [
  { sym: '\\psi(x,t)', text: 'комплексная огибающая волнового пакета (амплитуда + фаза волнения в точке x в момент t). |ψ| — высота волнения.' },
  { sym: 'i', text: 'мнимая единица.' },
  { sym: '\\psi_t', text: 'скорость изменения огибающей во времени.' },
  { sym: '\\psi_{xx}', text: 'вторая производная по x: кривизна огибающей, отвечает за дисперсионное расплывание пакета.' },
  { sym: '|\\psi|^2\\psi', text: 'нелинейный член: собственная интенсивность волны влияет на её же эволюцию — источник самофокусировки и роста аномальных пиков.' },
  { sym: 'x', text: 'координата вдоль направления распространения волн.' },
  { sym: 't', text: 'время.' },
  { sym: 'A_0', text: 'амплитуда фонового волнения. В безразмерных переменных A₀ = 1; физическая амплитуда a₀ задаётся в параметрах.', hl: 'A0' },
  { sym: '\\varepsilon', text: 'относительная амплитуда начального малого возмущения.', hl: 'eps' },
  { sym: 'k', text: 'волновое число возмущения; растёт только при 0 < k < 2·A₀ (неустойчивость Бенджамина—Фейра).', hl: 'k' },
];

export function App() {
  const A0 = 1; // безразмерная амплитуда фона; физический масштаб — a0, Tp
  const [a0, setA0] = useState(1.5);
  const [Tp, setTp] = useState(10);
  const [eps, setEps] = useState(0.05);
  const [k, setK] = useState(1);
  const [thr, setThr] = useState(2.0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [hl, setHl] = useState<HL>(null);
  const [frame, setFrame] = useState(0);
  const [m, setM] = useState<Metrics>({ t: 0, hmax: 0, peak: 0 });
  const [records, setRecords] = useState<RogueRecord[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const peakRef = useRef(0);
  const accRef = useRef(0);
  const inRogueRef = useRef(false);
  const recIdRef = useRef(0);
  const sc = useMemo(() => scales(a0, Tp), [a0, Tp]);
  const live = useRef({ A0, thr, speed, sc, a0 });
  live.current = { A0, thr, speed, sc, a0 };

  const redraw = useCallback(() => {
    const c = canvasRef.current, sim = simRef.current;
    if (!c || !sim) return;
    const { A0, thr } = live.current;
    draw(c, sim, { Hs: A0, threshold: thr, viewHalf: null, xScale: live.current.sc.L, hScale: 2 * live.current.a0 });
  }, []);

  const sync = useCallback(() => {
    const sim = simRef.current!;
    const hmax = sim.maxAmp();
    peakRef.current = Math.max(peakRef.current, hmax);
    setM({ t: sim.t, hmax, peak: peakRef.current });

    const { A0, thr } = live.current;
    const ai = hmax / A0;
    if (ai >= thr) {
      const t = sim.t;
      if (!inRogueRef.current) {
        inRogueRef.current = true;
        const id = recIdRef.current++;
        setRecords((rs) => [...rs, { id, t0: t, t, hmax, ai }]);
      } else {
        // эпизод продолжается: держим в записи максимум
        setRecords((rs) => {
          const last = rs[rs.length - 1];
          if (!last || hmax <= last.hmax) return rs;
          return [...rs.slice(0, -1), { ...last, t, hmax, ai }];
        });
      }
    } else {
      inRogueRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    simRef.current = initPerturbed(A0, eps, k);
    peakRef.current = 0;
    accRef.current = 0;
    inRogueRef.current = false;
    setRecords([]);
    setFrame(0);
    setPlaying(false);
    sync();
    redraw();
  }, [A0, eps, k, sync, redraw]);

  useEffect(() => { reset(); }, [reset]);
  useEffect(() => {
    // записи зависят от порога — при его смене сбрасываем и пересчитываем текущий кадр
    inRogueRef.current = false;
    setRecords([]);
    if (simRef.current) sync();
    redraw();
  }, [thr, sync, redraw]);
  useEffect(() => { redraw(); }, [sc, redraw]);
  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  const advance = useCallback((frames: number) => {
    const sim = simRef.current!;
    let n = frames * STEPS_PER_FRAME;
    while (n-- > 0) sim.step();
    sync();
    redraw();
  }, [sync, redraw]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    advance(1);
    setFrame((v) => v + 1);
  }, [advance]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    setFrame((v) => {
      const nv = Math.max(0, v - 1);
      simRef.current = initPerturbed(A0, eps, k);
      peakRef.current = 0;
      let n = nv * STEPS_PER_FRAME;
      while (n-- > 0) simRef.current.step();
      // откатываем записи, начавшиеся позже нового момента времени
      const tNow = simRef.current.t;
      setRecords((rs) => rs.filter((r) => r.t0 <= tNow));
      inRogueRef.current = simRef.current.maxAmp() / A0 >= live.current.thr;
      sync();
      redraw();
      return nv;
    });
  }, [A0, eps, k, sync, redraw]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const { speed } = live.current;
      accRef.current += speed;
      const frames = Math.floor(accRef.current);
      accRef.current -= frames;
      if (frames > 0) { advance(frames); setFrame((v) => v + frames); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, advance]);

  const Hs = A0;
  const ai = m.hmax / Hs;
  const aiMax = m.peak / Hs;
  const rogue = ai >= thr;
  const rogueEver = aiMax >= thr;
  const kOut = !(k > 0 && k < 2 * A0);
  const lam2 = bfLambda2(k, A0);
  const hM = (a: number) => 2 * a0 * a; // высота волны = 2·амплитуда, м
  const cls = (v: boolean) => (v ? ' rogue' : '');

  const nse = 'i\\,\\psi_t + \\tfrac{1}{2}\\,\\psi_{xx} + |\\psi|^2\\,\\psi = 0';
  const ic = `\\psi(x,0) = ${f(A0)}\\,\\bigl(1 + ${f(eps, 3)}\\cos(${f(k)}\\,x)\\bigr)\\,e^{i\\cdot 0}`;
  const lam = `\\lambda^2 = k^2\\left(A_0^2 - \\tfrac{k^2}{4}\\right) = ${f(lam2, 3)}` + (lam2 > 0 ? `,\\; \\lambda = ${f(Math.sqrt(lam2), 3)}` : '');
  const aiF = `AI = \\frac{H_{max}}{H_s} = \\frac{${f(m.hmax, 3)}}{${f(Hs, 3)}} = ${f(ai, 3)}\\;${rogue ? '\\ge' : '<'}\\; ${f(thr, 1)}`;

  return (
    <div className="app">
      <header>
        <h1>Калькулятор волн-убийц</h1>
        <span className="note">кадр {frame} · t = {fmtTime(m.t * sc.T)}</span>
      </header>
      <div className="grid">
        <div className="col">
          <section>
            <h2>Параметры</h2>
            <Param id="A0" label="a₀ — амплитуда фона" unit="м" min={0.5} max={5} step={0.1} value={a0} onChange={setA0} hl={hl} />
            <Param id="Tp" label="T_p — период несущей волны" unit="с" min={5} max={20} step={0.5} value={Tp} onChange={setTp} hl={hl} />
            <Param id="eps" label="ε — возмущение" unit="доля от a₀" min={0.01} max={0.2} step={0.005} value={eps} onChange={setEps} hl={hl} />
            <Param id="k" label="k — волновое число возмущения" unit="рад/м" min={0.1} max={2} step={0.05} value={k} scale={1 / sc.L} onChange={setK} hl={hl} />
            <Param id="thr" label="порог AI" unit="× H_s" min={2} max={2.5} step={0.1} value={thr} onChange={setThr} hl={hl} />
            {kOut && <div className="warn">k ∉ (0, {f(2 / sc.L, 4)} рад/м): возмущение не растёт, волны-убийцы не будет.</div>}
            {!kOut && <div className="note">λ² = {f(lam2, 3)} — возмущение растёт со временем.</div>}
            <div className="note">
              k₀ = {f(sc.k0, 4)} рад/м · λ₀ = {f(sc.lambda0, 0)} м · крутизна k₀a₀ = {f(sc.steepness, 3)}<br />
              длина модуляции Λ = {f((2 * Math.PI * sc.L) / k, 0)} м · область расчёта {f(domainLength(k) * sc.L, 0)} м<br />
              масштабы: 1 ед. x = {f(sc.L, 0)} м, 1 ед. t = {f(sc.T, 0)} с
            </div>
          </section>
          <section>
            <h2>Показатели</h2>
            <div className="metrics">
              <div><span>H_s (фон)</span><span className="val">{f(hM(Hs), 2)} м</span></div>
              <div />
              <div className={cls(rogue)}><span>H_max (сейчас)</span><span className="val">{f(hM(m.hmax), 2)} м</span></div>
              <div className={cls(rogueEver)}><span>H_max (макс.)</span><span className="val">{f(hM(m.peak), 2)} м</span></div>
              <div className={cls(rogue)}><span>AI (сейчас)</span><span className="val">{f(ai, 3)}</span></div>
              <div className={cls(rogueEver)}><span>M = AI (макс.)</span><span className="val">{f(aiMax, 3)}</span></div>
            </div>
            <div className={'status' + cls(rogue)}>{rogue ? 'волна-убийца' : 'норма'}</div>
            <h2 style={{ marginTop: 14 }}>Зафиксированные волны-убийцы</h2>
            {records.length === 0
              ? <div className="note">пока не зафиксировано</div>
              : <ol className="records">
                  {records.map((r, i) => (
                    <li key={r.id} className="rogue">
                      <span>#{i + 1} · t = {fmtTime(r.t * sc.T)}</span>
                      <span>H_max = {f(hM(r.hmax), 2)} м · AI = {f(r.ai, 3)}</span>
                    </li>
                  ))}
                </ol>}
          </section>
        </div>
        <div className="col">
          <section>
            <h2>|ψ(x,t)|</h2>
            <canvas ref={canvasRef} />
            <div className="row controls" style={{ marginTop: 10 }}>
              <button className="btn-icon" onClick={reset} title="Сброс">
                <span className="ico">↺</span><span className="cap">Сброс</span>
              </button>
              <button className="btn-icon" onClick={stepBack} disabled={playing} title="Шаг назад">
                <span className="ico">⏮</span><span className="cap">Назад</span>
              </button>
              <button className="btn-icon" onClick={() => setPlaying((p) => !p)} title={playing ? 'Пауза' : 'Пуск'}>
                <span className="ico">{playing ? '⏸' : '▶'}</span><span className="cap">{playing ? 'Пауза' : 'Пуск'}</span>
              </button>
              <button className="btn-icon" onClick={stepForward} disabled={playing} title="Шаг вперёд">
                <span className="ico">⏭</span><span className="cap">Вперёд</span>
              </button>
              <span style={{ marginLeft: 12 }}>скорость</span>
              <input type="range" min={0.25} max={8} step={0.25} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
              <span>×{f(speed)}</span>
            </div>
          </section>
          <section>
            <h2>Формула</h2>
            <div className="formula">
              <Tex src={nse} block />
              <Tex src={ic} block />
              <Tex src={lam} block />
              <Tex src={aiF} block />
            </div>
            <ul className="legend">
              {LEGEND.map((it) => (
                <li key={it.sym} className={it.hl ? 'link' : ''}
                  onMouseEnter={() => it.hl && setHl(it.hl)} onMouseLeave={() => setHl(null)}
                  onClick={() => it.hl && setHl(it.hl)}>
                  <span className="sym"><Tex src={it.sym} /></span><span>{it.text}</span>
                </li>
              ))}
              <li className="link" onMouseEnter={() => setHl('thr')} onMouseLeave={() => setHl(null)} onClick={() => setHl('thr')}>
                <span className="sym"><Tex src="AI" /></span>
                <span>индекс усиления: H_max — максимум |ψ| по x в кадре, H_s = A₀ — фоновая высота. AI ≥ порога — волна-убийца.</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
