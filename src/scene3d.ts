import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Sim2D } from './sim2d';
import { scales } from './physical';

export interface SceneOpts {
  a0: number;
  Tp: number;
  threshold: number;
  /** номер кадра: от него зависит фаза несущей, показанная замедленно */
  frame: number;
}

/** половина показываемой области, безразмерных ед. (1 ед. = L метров) */
export const XV = 10;
export const YV = 14;
export const NX = 641;
export const NY = 113;
/** высота сцены, соответствующая верху оси высоты */
export const SCENE_H = 3.2;
const PEAK = 3.2;
/** сдвиг фазы несущей за кадр, рад: реальный (~9 рад) выглядит как мерцание */
const PHASE_PER_FRAME = 0.45;
const MIN_SAMPLES_PER_WAVE = 8;

function niceStep(range: number) {
  const raw = range / 6, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

/** Верх оси высоты, м: зависит только от входных параметров, в ходе симуляции не меняется. */
export function zMaxMeters(a0: number, threshold: number): number {
  const need = Math.max(PEAK, threshold * 1.1) * a0;
  const tick = niceStep(need);
  return Math.ceil(need / tick - 1e-9) * tick;
}

export interface SceneInfo {
  /** во сколько раз вертикаль растянута относительно горизонтали */
  exaggeration: number;
  /** несущая показана реже реальной (иначе её не разрешить сеткой) */
  carrierClamped: boolean;
  /** число несущих волн поперёк показанной области по x */
  waveCount: number;
}

/** Высоты поверхности и амплитуды огибающей на сетке показа; общая часть для WebGL и запасного canvas-режима. */
export class Surface {
  /** η в единицах сцены, построчно по y (NY строк по NX точек) */
  readonly h = new Float32Array(NX * NY);
  /** |ψ| на той же сетке */
  readonly amp = new Float32Array(NX * NY);
  info: SceneInfo = { exaggeration: 1, carrierClamped: false, waveCount: 0 };
  private cosT = new Float64Array(NX);
  private sinT = new Float64Array(NX);

  /** η = Re(A e^{iθ}) + Re(½k₀A² e^{2iθ}), A = a₀ψ. */
  fill(sim: Sim2D, o: SceneOpts) {
    const sc = scales(o.a0, o.Tp);
    const zMax = zMaxMeters(o.a0, o.threshold);
    const zs = SCENE_H / zMax; // сцена на метр высоты
    const dx = (2 * XV) / (NX - 1);
    const Kreal = sc.k0 * sc.L;
    const Kmax = (2 * Math.PI) / (MIN_SAMPLES_PER_WAVE * dx);
    const K = Math.min(Kreal, Kmax);
    const k0eff = sc.k0 * (K / Kreal); // k₀ для второй гармоники берём пропорционально, чтобы форма гребня сохранялась
    this.info = {
      exaggeration: (SCENE_H / zMax) * sc.L,
      carrierClamped: Kreal > Kmax,
      waveCount: (2 * XV * K) / (2 * Math.PI),
    };
    const th0 = -PHASE_PER_FRAME * o.frame;
    for (let i = 0; i < NX; i++) {
      const x = -XV + i * dx;
      this.cosT[i] = Math.cos(K * x + th0);
      this.sinT[i] = Math.sin(K * x + th0);
    }
    const { re, im, Nx, Ny, Lx, Ly } = sim;
    const a0 = o.a0;
    const gx = Nx / Lx, gy = Ny / Ly;
    let v = 0;
    for (let j = 0; j < NY; j++) {
      const y = -YV + (j * 2 * YV) / (NY - 1);
      let fy = (y + Ly / 2) * gy;
      fy = Math.min(Math.max(fy, 0), Ny - 1.0001);
      const iy = Math.floor(fy), ty = fy - iy;
      for (let i = 0; i < NX; i++, v++) {
        const x = -XV + i * dx;
        let fx = (x + Lx / 2) * gx;
        fx = Math.min(Math.max(fx, 0), Nx - 1.0001);
        const ix = Math.floor(fx), tx = fx - ix;
        const j00 = iy * Nx + ix, j10 = j00 + 1, j01 = j00 + Nx, j11 = j01 + 1;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const pr = re[j00] * w00 + re[j10] * w10 + re[j01] * w01 + re[j11] * w11;
        const pi = im[j00] * w00 + im[j10] * w10 + im[j01] * w01 + im[j11] * w11;
        const ct = this.cosT[i], st = this.sinT[i];
        const c2 = ct * ct - st * st, s2 = 2 * ct * st;
        // A = a0 ψ; первая гармоника + связанная вторая (Chabchoub и др. 2012)
        const eta1 = a0 * (pr * ct - pi * st);
        const eta2 = 0.5 * k0eff * a0 * a0 * ((pr * pr - pi * pi) * c2 - 2 * pr * pi * s2);
        this.h[v] = (eta1 + eta2) * zs;
        this.amp[v] = Math.hypot(pr, pi);
      }
    }
  }
}

/** Общий интерфейс окна показа: WebGL или запасной canvas. */
export interface Viewer {
  info: SceneInfo;
  update(sim: Sim2D, o: SceneOpts): void;
  dispose(): void;
}

/** Есть ли в браузере WebGL (в VS Code Simple Browser и при отключённом ускорении его нет). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export class Scene3D implements Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private geo: THREE.PlaneGeometry;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private thrPlane: THREE.Mesh;
  private ro: ResizeObserver;
  private surface = new Surface();
  info: SceneInfo = { exaggeration: 1, carrierClamped: false, waveCount: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0xffffff);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.camera.position.set(-16, 13, 27);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.3, 0);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener('change', () => this.draw());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4d0, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-8, 12, 6);
    this.scene.add(sun);

    this.geo = new THREE.PlaneGeometry(2 * XV, 2 * YV, NX - 1, NY - 1);
    this.geo.rotateX(-Math.PI / 2);
    this.pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    this.col = new THREE.BufferAttribute(new Float32Array(this.pos.count * 3), 3);
    this.geo.setAttribute('color', this.col);
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
    }));
    this.scene.add(mesh);

    // рамка области и плоскость порога
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * XV, SCENE_H, 2 * YV)),
      new THREE.LineBasicMaterial({ color: 0x000000 }),
    );
    box.position.y = SCENE_H / 2;
    this.scene.add(box);
    const grid = new THREE.GridHelper(2 * XV, 10, 0x999999, 0xcccccc);
    grid.scale.z = YV / XV;
    this.scene.add(grid);
    this.thrPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * XV, 2 * YV).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe00000, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scene.add(this.thrPlane);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  dispose() {
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.geo.dispose();
  }

  draw() { this.renderer.render(this.scene, this.camera); }

  /** Обновляет поверхность по состоянию симуляции. */
  update(sim: Sim2D, o: SceneOpts) {
    const surf = this.surface;
    surf.fill(sim, o);
    this.info = surf.info;
    const zs = SCENE_H / zMaxMeters(o.a0, o.threshold);
    this.thrPlane.position.y = o.threshold * o.a0 * zs;
    const thr = o.threshold;
    const p = this.pos.array as Float32Array, c = this.col.array as Float32Array;
    for (let v = 0; v < NX * NY; v++) {
      p[3 * v + 1] = surf.h[v];
      // серо-голубой → красный по мере приближения огибающей к порогу AI
      const m = Math.min(1, Math.max(0, (surf.amp[v] - 1.2) / (thr - 1.2)));
      c[3 * v] = 0.55 + 0.4 * m;
      c[3 * v + 1] = 0.68 - 0.6 * m;
      c[3 * v + 2] = 0.78 - 0.7 * m;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.draw();
  }
}
