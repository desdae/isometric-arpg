import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Grade runs in linear HDR before tonemapping: crushes and reddens shadows,
// keeps warm highlights warm, adds vignette and fine film grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    shadowTint: { value: new THREE.Vector3(1.06, 0.92, 0.9) },
    highlightTint: { value: new THREE.Vector3(1.08, 0.96, 0.86) },
    exposure: { value: 1.2 },
    contrast: { value: 1.08 },
    saturation: { value: 0.95 },
    vignette: { value: 0.55 },
    grain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, exposure, contrast, saturation, vignette, grain;
    uniform vec3 shadowTint, highlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float hl = smoothstep(0.05, 0.8, l);
      c *= mix(shadowTint, highlightTint, hl);
      c = mix(vec3(l), c, saturation);
      // Contrast around a low pivot suits a dark scene.
      c = max(vec3(0.0), (c - 0.18) * contrast + 0.18);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * vignette * 2.2;
      c *= clamp(v, 0.0, 1.0);
      c += (hash(vUv * 1000.0 + time) - 0.5) * grain * (0.3 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

/**
 * Objects kept out of the ambient-occlusion pass. GTAO renders the scene's
 * depth and normals with an override material, so see-through things (mist
 * sheets, blood decals, flames) would be treated as solid and cast dark AO
 * creases onto the ground that drift with them.
 */
export const noAO = new Set<THREE.Object3D>();

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly grade: ShaderPass;
  readonly bloom: UnrealBloomPass;
  readonly ao: GTAOPass;
  private renderPass: RenderPass;

  constructor(
    container: HTMLElement,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The composer renders the scene more than once a frame (AO needs its own
    // normal pass); draw the shadow map only once, in render().
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    composer.addPass(this.ao);
    // Hide transparent and registered objects while the AO pass draws depth.
    const aoRender = this.ao.render.bind(this.ao);
    this.ao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden = this.aoHidden();
      for (const o of hidden) o.visible = false;
      aoRender(...args);
      for (const o of hidden) o.visible = true;
    };

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.5, 1.0);
    composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;

    window.addEventListener('resize', () => this.resize());
  }

  private aoCache = new WeakMap<THREE.Scene, THREE.Object3D[]>();

  /** Visible objects to hide from AO this frame: registered ones plus every transparent mesh or point cloud in the scene (scanned once per scene). */
  private aoHidden(): THREE.Object3D[] {
    const scene = this.renderPass.scene as THREE.Scene;
    let list = this.aoCache.get(scene);
    if (!list) {
      list = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.Material | undefined;
        if ((o as THREE.Points).isPoints || (mat && !Array.isArray(mat) && mat.transparent)) list!.push(o);
      });
      this.aoCache.set(scene, list);
    }
    const out: THREE.Object3D[] = [];
    for (const o of list) if (o.visible) out.push(o);
    for (const o of noAO) if (o.visible) out.push(o);
    return out;
  }

  /** Switches the rendered scene (travelling between areas). */
  setScene(scene: THREE.Scene) {
    this.renderPass.scene = scene;
    this.ao.scene = scene;
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  render(time: number) {
    this.grade.uniforms.time.value = time % 100;
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }
}
