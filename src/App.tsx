import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tex } from './Tex';
import { Scene3D, webglAvailable, type SceneInfo, type Viewer } from './scene3d';
import { SceneFallback } from './sceneFallback';
import { SEA2D_DT, SEA2D_T_END, Sea2D, type Sim2D } from './sim2d';
import { fmtTime, scales } from './physical';

type HL = 'A0' | 'Tp' | 'thr' | null;

interface Metrics { t: number; hmax: number; peak: number; }

/** Зафиксированная волна-убийца: эпизод превышения порога AI. */
interface RogueRecord { id: number; t0: number; t: number; hmax: number; ai: number; }

const f = (v: number, d = 2) => v.toFixed(d);

/** шаг по безразмерному времени между кадрами */
const FRAME_DT = 0.032;
const STEPS_PER_FRAME = Math.round(FRAME_DT / SEA2D_DT);
/** каждый KEY-й кадр сохраняем состояние, чтобы «Назад» не пересчитывал всё с нуля */
const KEY = 8;

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
  { sym: 'y', text: 'поперечная координата (вдоль гребня). Дисперсия по y имеет противоположный знак и вдвое больший коэффициент: уравнение гиперболическое.' },
  { sym: '\\eta', text: 'возвышение поверхности воды — то, что показано в 3D: несущая волна под огибающей плюс стоксова поправка второго порядка (острые гребни).' },
  { sym: 't', text: 'время.' },
  { sym: 'A_0', text: 'амплитуда фонового волнения. В безразмерных переменных A₀ = 1; физическая амплитуда a₀ задаётся в параметрах.', hl: 'A0' },
];

export function App() {
  const A0 = 1; // безразмерная амплитуда фона; физический масштаб — a0, Tp
  const [a0, setA0] = useState(1.5);
  const [Tp, setTp] = useState(10);
  const [thr, setThr] = useState(2.0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [hl, setHl] = useState<HL>(null);
  const [frame, setFrame] = useState(0);
  const [m, setM] = useState<Metrics>({ t: 0, hmax: 0, peak: 0 });
  const [records, setRecords] = useState<RogueRecord[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Viewer | null>(null);
  const simRef = useRef<Sim2D | null>(null);
  const keysRef = useRef<Map<number, ReturnType<Sim2D['snapshot']>>>(new Map());
  const frameRef = useRef(0);
  /** накопленный максимум |ψ| на каждом кадре: нужен, чтобы «Назад» восстанавливал пик */
  const peaksRef = useRef<number[]>([]);
  const peakRef = useRef(0);
  const accRef = useRef(0);
  const inRogueRef = useRef(false);
  const recIdRef = useRef(0);
  const sc = useMemo(() => scales(a0, Tp), [a0, Tp]);
  const live = useRef({ A0, thr, speed, sc, a0, Tp });
  live.current = { A0, thr, speed, sc, a0, Tp };
  const [info, setInfo] = useState<SceneInfo | null>(null);

  const redraw = useCallback(() => {
    const scene = sceneRef.current, sim = simRef.current;
    if (!scene || !sim) return;
    const { thr, a0, Tp } = live.current;
    scene.update(sim, { a0, Tp, threshold: thr, frame: frameRef.current });
    setInfo(scene.info);
  }, []);

  const sync = useCallback(() => {
    const sim = simRef.current!;
    const hmax = sim.maxAmp();
    peakRef.current = Math.max(peakRef.current, hmax);
    peaksRef.current[frameRef.current] = peakRef.current;
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
    // начальное поле считается один раз и дальше берётся из сохранённого кадра 0
    if (!simRef.current) {
      simRef.current = new Sea2D();
      keysRef.current.set(0, simRef.current.snapshot());
    } else {
      simRef.current.restore(keysRef.current.get(0)!);
    }
    frameRef.current = 0;
    peaksRef.current = [];
    peakRef.current = 0;
    accRef.current = 0;
    inRogueRef.current = false;
    setRecords([]);
    setFrame(0);
    setPlaying(false);
    sync();
    redraw();
  }, [sync, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    // без WebGL (отключено ускорение, Simple Browser в VS Code) — запасной режим на canvas 2D
    let scene: Viewer;
    try { scene = webglAvailable() ? new Scene3D(canvas) : new SceneFallback(canvas); }
    catch { scene = new SceneFallback(canvas); }
    sceneRef.current = scene;
    reset();
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [reset]);
  useEffect(() => {
    // записи зависят от порога — при его смене сбрасываем и пересчитываем текущий кадр
    inRogueRef.current = false;
    setRecords([]);
    if (simRef.current) sync();
    redraw();
  }, [thr, sync, redraw]);
  useEffect(() => { redraw(); }, [sc, redraw]);

  const advance = useCallback((frames: number) => {
    const sim = simRef.current!;
    const tEnd = SEA2D_T_END / (A0 * A0);
    // сценарий ограничен: позже модуляционная неустойчивость разрушает картину
    for (let k = 0; k < frames && sim.t < tEnd - 1e-9; k++) {
      for (let n = 0; n < STEPS_PER_FRAME; n++) sim.step();
      frameRef.current++;
      if (frameRef.current % KEY === 0 && !keysRef.current.has(frameRef.current)) {
        keysRef.current.set(frameRef.current, sim.snapshot());
      }
    }
    sync();
    redraw();
    if (sim.t >= tEnd - 1e-9) setPlaying(false);
    setFrame(frameRef.current);
  }, [sync, redraw]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    advance(1);
  }, [advance]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    const sim = simRef.current!;
    const target = Math.max(0, frameRef.current - 1);
    const base = Math.floor(target / KEY) * KEY;
    sim.restore(keysRef.current.get(base)!);
    for (let k = base; k < target; k++) for (let n = 0; n < STEPS_PER_FRAME; n++) sim.step();
    frameRef.current = target;
    // пик за прошедшее время и записи пересчитываем по сохранённым кадрам
    const tNow = sim.t;
    setRecords((rs) => rs.filter((r) => r.t0 <= tNow));
    peaksRef.current.length = target;
    peakRef.current = peaksRef.current[target - 1] ?? 0;
    inRogueRef.current = sim.maxAmp() / A0 >= live.current.thr;
    sync();
    redraw();
    setFrame(target);
  }, [sync, redraw]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const { speed } = live.current;
      accRef.current += speed;
      const frames = Math.floor(accRef.current);
      accRef.current -= frames;
      if (frames > 0) advance(frames);
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
  const hM = (a: number) => 2 * a0 * a; // высота волны = 2·амплитуда огибающей, м
  const cls = (v: boolean) => (v ? ' rogue' : '');

  const nse = 'i\\,\\psi_t + \\tfrac{1}{2}\\,\\psi_{xx} - \\psi_{yy} + |\\psi|^2\\,\\psi = 0';
  const eta = '\\eta = \\mathrm{Re}\\bigl[A\\,e^{i\\theta}\\bigr] + \\mathrm{Re}\\bigl[\\tfrac{1}{2}k_0A^2\\,e^{2i\\theta}\\bigr],\\; A = a_0\\psi,\\; \\theta = k_0x - \\omega_0 t';
  const ic = `\\psi(x,y,0) = e^{-it_0} + \\bigl[\\psi_P(x,-t_0) - e^{-it_0}\\bigr]e^{-y^2/2W^2} + \\xi(x,y),\\quad \\psi_P(x,t) = A_0\\,e^{iA_0^2 t}\\left[1 - \\frac{4\\,(1 + 2iA_0^2 t)}{1 + 4A_0^2 x^2 + 4A_0^4 t^2}\\right]`;
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
            <Param id="thr" label="порог AI" unit="× H_s" min={2} max={2.5} step={0.1} value={thr} onChange={setThr} hl={hl} />
            <div className="note">
              k₀ = {f(sc.k0, 4)} рад/м · λ₀ = {f(sc.lambda0, 0)} м · крутизна k₀a₀ = {f(sc.steepness, 3)}<br />
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
            <h2>Поверхность воды η(x, y, t)</h2>
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
              <Tex src={eta} block />
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
                <span>индекс усиления: H_max — максимум |ψ| по x и y в кадре, H_s = 2a₀ — высота фоновой несущей волны. AI ≥ порога — волна-убийца.</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
