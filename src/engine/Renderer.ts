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
    /** Denoised ambient occlusion, at half resolution. */
    tAO: { value: null as THREE.Texture | null },
    aoIntensity: { value: 0 },
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
    uniform sampler2D tDiffuse, tAO;
    uniform float aoIntensity;
    uniform float time, exposure, contrast, saturation, vignette, grain;
    uniform vec3 shadowTint, highlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
      c *= mix(vec3(1.0), texture2D(tAO, vUv).rgb, aoIntensity);
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

// three shades every point light at every pixel, even where it is out of
// range. Skip the lighting maths for a light that cannot reach this pixel;
// neighbouring pixels agree, so the branch is nearly free on the GPU.
{
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const call = 'RE_Direct( directLight, geometryPosition';
  const at = chunk.indexOf(call, chunk.indexOf('NUM_POINT_LIGHTS > 0'));
  if (at > 0) THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, at) + 'if ( directLight.visible ) ' + chunk.slice(at);
  // Faces turned away from the moon get no moonlight anyway: skip their 16
  // shadow-map reads.
  // A real if: some drivers evaluate both sides of a ?: (ANGLE's HLSL does).
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (getShadow\( directionalShadowMap\[ i \][^;]*\)) : 1\.0;/,
    'if ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) directLight.color *= $1;',
  );
}

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

    // AO is soft and low frequency: half resolution looks the same at a quarter of the cost.
    this.ao = new GTAOPass(scene, camera, Math.ceil(size.x / 2), Math.ceil(size.y / 2));
    const aoSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w: number, h: number) => aoSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 8 });
    this.ao.blendIntensity = 0.85;
    this.ao.updatePdMaterial({ samples: 12 });
    // The grade pass multiplies the AO in, so the AO pass draws nothing at full
    // resolution itself (by default it copies the whole frame and blends over it).
    this.ao.output = GTAOPass.OUTPUT.Off;
    this.ao.needsSwap = false;
    composer.addPass(this.ao);
    // AO reads the scene pass's own depth buffer instead of drawing the whole
    // scene a second time for depth and normals (normals come from the depth).
    // See-through things write no depth, so they cast no AO, as before.
    // (renderTarget2 is the multisampled scene target; render() keeps it so.)
    const sceneRT = composer.renderTarget2;
    sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.ao.setGBuffer(sceneRT.depthTexture);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.5, 1.0);
    composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tAO.value = this.ao.pdRenderTarget.texture;
    composer.addPass(this.grade);
    // Only the scene pass needs multisampling; the full-screen passes after it
    // write to a plain target (4 samples per pixel is 4× the memory traffic).
    composer.renderTarget1.samples = 0;
    composer.addPass(new OutputPass());
    this.composer = composer;

    window.addEventListener('resize', () => this.resize());
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

  private lastRender = 0;
  private shadowSkipped = false;

  /** `fullShadow` always redraws the shadow map (warm-up frames). */
  render(time: number, fullShadow = false) {
    this.grade.uniforms.time.value = time % 100;
    // Above ~125 FPS, redraw the shadow map every other frame: a shadow one
    // frame (under 8 ms) behind is invisible, and the shadow pass is the
    // costliest part of the frame for the CPU. A skipped frame keeps the old
    // shadow matrices too, so the map and its projection always match.
    const now = performance.now();
    this.shadowSkipped = !fullShadow && now - this.lastRender < 8 && !this.shadowSkipped;
    this.lastRender = now;
    this.renderer.shadowMap.needsUpdate = !this.shadowSkipped;
    // Walk the scene graph to update matrices once here, not in every render call.
    const scene = this.renderPass.scene;
    this.grade.uniforms.aoIntensity.value = this.ao.enabled ? this.ao.blendIntensity : 0;
    // The scene (and the bloom added onto it) must land in the multisampled target.
    const c = this.composer;
    if (c.readBuffer.samples === 0 && c.writeBuffer.samples > 0) c.swapBuffers();
    scene.matrixWorldAutoUpdate = false;
    scene.updateMatrixWorld();
    this.composer.render();
  }
}
