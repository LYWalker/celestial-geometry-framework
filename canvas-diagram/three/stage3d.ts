/**
 * What `Stage` is to the 2D layer, for three.js: everything a figure in this
 * kit needs before it can start declaring what it is actually about.
 *
 * A renderer and a scene; a camera that orbits the figure rather than sitting
 * in front of it; the kit's own night sky, in the same two colours, with the
 * same warm-white twinkling stars and the same vignette the 2D `Stage` paints
 * — so a 3D figure and a 2D one on the same page look like they belong to
 * each other. A figure supplies its geometry and its meaning; this supplies
 * the room it stands in.
 *
 * The one thing worth knowing before using it: **this is a z-up world.** x
 * and y span the reference plane (the ecliptic, in these figures) and z is
 * its north, matching `polar()`'s convention in the 2D layer so a bearing
 * means the same thing in both. three defaults to y-up and OrbitControls
 * orbits about whatever the camera calls up, so a y-up camera in a z-up world
 * tumbles the figure instead of walking round it. Stage3D sets `camera.up`
 * for you; it is called out here because it is invisible until it is wrong.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;

/** The same shape the 2D `Stage` takes, so one palette themes both. */
export interface Background3D {
  /** the wash's colour at the centre */
  mid: string;
  /** and at its edge */
  deep: string;
  /** the stars */
  star: string;
  /** the darkening at the corners, at full strength */
  vignette: string;
}

export interface Starfield3DOptions {
  count?: number;
  /** how far out the star sphere sits. Must be well beyond anything the
   * figure draws, and inside the camera's far plane. */
  radius?: number;
  /** how many get a halo, as the 2D field's brightest layer does */
  bright?: number;
}

export interface OrbitCameraOptions {
  /** world units from the target */
  distance: number;
  /** degrees, anticlockwise from +x seen from the north */
  yaw?: number;
  /** degrees above the reference plane. 0 is in it; 90 is straight down. */
  pitch?: number;
  /** vertical field of view, degrees. Default 38. */
  fov?: number;
  target?: THREE.Vector3;
  near?: number;
  far?: number;
}

export interface Controls3DOptions {
  autoRotate?: boolean;
  /** three's own units; ~0.55 is a circuit in about two minutes */
  autoRotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  enablePan?: boolean;
}

export interface Stage3DOptions {
  /** the WebGL canvas */
  canvas: HTMLCanvasElement;
  /** the element that sizes the figure, and that the wash is painted on */
  container: HTMLElement;
  background?: Background3D;
  stars?: Starfield3DOptions;
  camera: OrbitCameraOptions;
  controls?: Controls3DOptions;
  /** called after the canvas has been resized, with its new CSS size — for
   * a figure that has its own overlay to keep in step. Also settable after
   * construction (`stage.onResize = ...`), which is usually what a figure
   * wants: the overlay belongs to an Annotator3D that needs the stage's
   * camera to exist first, so it cannot be referenced from inside this
   * object literal without tripping over its own declaration. */
  onResize?: (width: number, height: number) => void;
}

/**
 * The same colour with its alpha taken to zero, for a gradient's inner stop.
 * Done by rewriting the alpha channel rather than by re-deriving the colour,
 * because a gradient interpolates in premultiplied space in some browsers and
 * "transparent black" is visibly not the same inner stop as "this colour,
 * transparent" when the outer stop is anything but black.
 */
function transparentOf(css: string): string {
  const m = /^rgba?\(([^)]+)\)$/i.exec(css.trim());
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},0)`;
  }
  const c = new THREE.Color(css);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0)`;
}

/** The 2D kit's own twinkle, so the two layers' skies breathe together. */
const TWINKLE = { base: 0.72, depth: 0.28, rate: 0.0009 };

export class Stage3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  /** CSS px */
  width = 0;
  height = 0;
  /** See `Stage3DOptions.onResize`. Public so it can be attached after the
   * things it needs have been built. */
  onResize: ((width: number, height: number) => void) | undefined;

  private starUniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#d8d4c8') } };
  private stars: THREE.Points | null = null;
  private vignetteGradient: CanvasGradient | null = null;
  private vignetteFor = '';
  private observer: ResizeObserver;

  constructor(private opts: Stage3DOptions) {
    // `alpha`, so the wash painted on the container shows through instead of
    // being covered by a flat clear colour.
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    // ACES keeps a sunlit limb from clipping to a flat white disc, which is
    // what makes a lit sphere read as a sphere rather than as a circle.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    const c = opts.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov ?? 38, 1, c.near ?? 1, c.far ?? 4000);
    this.camera.up.set(0, 0, 1);
    this.setCamera(c.distance, c.yaw ?? 0, c.pitch ?? 20);

    this.controls = new OrbitControls(this.camera, opts.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = opts.controls?.enablePan ?? false;
    this.controls.autoRotate = opts.controls?.autoRotate ?? true;
    this.controls.autoRotateSpeed = opts.controls?.autoRotateSpeed ?? 0.55;
    this.controls.minDistance = opts.controls?.minDistance ?? c.distance * 0.15;
    this.controls.maxDistance = opts.controls?.maxDistance ?? c.distance * 2.5;
    // Never quite over the pole: it is the one view in which an inclination
    // is invisible, and it is where the camera's own idea of up runs out.
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI - 0.12;
    if (c.target) this.controls.target.copy(c.target);

    if (opts.background) {
      this.paintWash(opts.background);
      this.seedStars(opts.background.star, opts.stars ?? {});
    }

    this.onResize = opts.onResize;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(opts.container);
    this.resize();
  }

  /** Put the camera at a bearing and elevation about its target. The same
   * three numbers the controls then maintain, so a figure can state its
   * opening view the way it would describe it. */
  setCamera(distance: number, yawDeg: number, pitchDeg: number): void {
    const t = this.opts.camera.target ?? new THREE.Vector3();
    const p = pitchDeg * DEG;
    const y = yawDeg * DEG;
    this.camera.position.set(
      t.x + distance * Math.cos(p) * Math.cos(y),
      t.y + distance * Math.cos(p) * Math.sin(y),
      t.z + distance * Math.sin(p),
    );
    this.camera.lookAt(t);
  }

  /** The wash, on the container rather than in the scene: it belongs *behind*
   * the stars, and the stars are in the scene so that they hold still while
   * the camera turns. Same two colours and same off-centre origin as the 2D
   * `Stage`'s own radial gradient. */
  private paintWash(bg: Background3D): void {
    this.opts.container.style.background =
      `radial-gradient(circle at 50% 45%, ${bg.mid} 0%, ${bg.deep} 78%, ${bg.deep} 100%)`;
  }

  /**
   * A sphere of stars. The 2D field can only parallax; this one holds still
   * while the camera moves round it, which is the thing that tells you it is
   * the camera moving and not the figure.
   *
   * A shader rather than `PointsMaterial` for two reasons: per-star twinkle
   * needs a per-star alpha, and `gl_PointCoord` gives round stars with a soft
   * edge where a plain point sprite gives squares.
   */
  private seedStars(color: string, opts: Starfield3DOptions): void {
    const n = opts.count ?? 900;
    const radius = opts.radius ?? 1600;
    const brightCount = opts.bright ?? 14;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const phase = new Float32Array(n);
    const dpr = Math.min(devicePixelRatio || 1, 2);

    for (let i = 0; i < n; i++) {
      // Uniform over the sphere, not over the angles: picking z uniformly is
      // what stops them bunching at the poles.
      const z = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos[i * 3] = Math.cos(a) * r * radius;
      pos[i * 3 + 1] = Math.sin(a) * r * radius;
      pos[i * 3 + 2] = z * radius;
      const layer = i % 3;
      const bright = i < brightCount;
      // gl_PointSize is in device pixels, so the dpr keeps a star the same
      // apparent size on a retina screen as on an ordinary one.
      size[i] = (bright ? 7 : 1.6 + Math.random() * 1.6 + layer * 0.6) * dpr;
      alpha[i] = 0.15 + Math.random() * 0.4 + layer * 0.08;
      phase[i] = Math.random() * Math.PI * 2;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    this.starUniforms.uColor.value = new THREE.Color(color);
    this.stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: `
          attribute float aSize;
          attribute float aAlpha;
          attribute float aPhase;
          uniform float uTime;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha * (${TWINKLE.base} + ${TWINKLE.depth} * sin(uTime * ${TWINKLE.rate} + aPhase));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize;
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
            float a = smoothstep(1.0, 0.0, r);
            a *= a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, vAlpha * a);
          }`,
      }),
    );
    this.scene.add(this.stars);
  }

  resize(): void {
    const r = this.opts.container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.width = r.width;
    this.height = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.onResize?.(r.width, r.height);
  }

  /** One frame. `timeMs` drives the twinkle; pass the same clock the figure's
   * own animation loop runs on. */
  render(timeMs: number): void {
    this.starUniforms.uTime.value = timeMs;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The vignette, for an overlay canvas — hand it straight to
   * `Annotator3D.draw`'s `beforeLabels`. Same stops as the 2D `Stage`, and
   * the same place in the order: over the rendered scene, under the names,
   * which have to stay readable on top of everything.
   */
  readonly drawVignette = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const bg = this.opts.background;
    if (!bg) return;
    const key = `${w}x${h}`;
    if (key !== this.vignetteFor) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, transparentOf(bg.vignette));
      g.addColorStop(1, bg.vignette);
      this.vignetteGradient = g;
      this.vignetteFor = key;
    }
    if (!this.vignetteGradient) return;
    ctx.fillStyle = this.vignetteGradient;
    ctx.fillRect(0, 0, w, h);
  };

  dispose(): void {
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
