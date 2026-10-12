import * as THREE from 'three';

// A town portal: an upright oval of swirling cold light over a glowing ring
// on the ground, with motes drifting up through it. It always turns to face
// the camera. The only blue in a red world, so it reads from across the map.

const swirl = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { t: { value: 0 }, open: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float t; uniform float open; varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float arms = sin(a * 3.0 + r * 9.0 - t * 3.2) * 0.5 + 0.5;
      float fine = sin(a * 7.0 - r * 16.0 + t * 5.0) * 0.5 + 0.5;
      float core = smoothstep(0.75, 0.0, r);
      float rim = smoothstep(0.62, 0.97, r) * smoothstep(1.0, 0.92, r);
      vec3 deep = vec3(0.01, 0.04, 0.22);
      vec3 cold = vec3(0.08, 0.25, 0.75);
      vec3 col = deep * (0.5 + core) + cold * (arms * 0.6 + fine * 0.2) * (0.2 + r * 0.8) + vec3(0.25, 0.45, 1.0) * rim * 0.9;
      float alpha = clamp(0.5 + rim * 0.6 + arms * 0.2, 0.0, 1.0) * open;
      gl_FragColor = vec4(col * alpha, alpha);
    }
  `,
});

const groundGlow = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { open: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float open; varying vec2 vUv;
    void main() {
      float r = length(vUv * 2.0 - 1.0);
      float ring = smoothstep(0.62, 0.8, r) * smoothstep(1.0, 0.82, r);
      float pool = smoothstep(1.0, 0.0, r) * 0.35;
      float a = (ring + pool) * open;
      gl_FragColor = vec4(vec3(0.08, 0.2, 0.6) * a, a);
    }
  `,
});

const moteMat = new THREE.PointsMaterial({
  color: new THREE.Color(0.35, 0.6, 1.3),
  size: 0.07,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
});

const MOTES = 36;

export class PortalFx {
  readonly group = new THREE.Group();
  private gate: THREE.Group;
  private motes: THREE.Points;
  private seeds = new Float32Array(MOTES * 3);
  private age = 0;
  private swirlMat = swirl.clone();
  private glowMat = groundGlow.clone();

  constructor(pos: THREE.Vector3) {
    this.group.position.copy(pos);
    this.gate = new THREE.Group();
    this.group.add(this.gate);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.5), this.swirlMat);
    disc.position.y = 1.35;
    this.gate.add(disc);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2), this.glowMat);
    glow.position.y = 0.04;
    this.group.add(glow);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    for (let i = 0; i < MOTES; i++) {
      this.seeds[i * 3] = Math.random() * Math.PI * 2;
      this.seeds[i * 3 + 1] = Math.random();
      this.seeds[i * 3 + 2] = 0.3 + Math.random() * 0.5;
    }
    this.motes = new THREE.Points(geo, moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    for (const o of [disc, glow]) o.renderOrder = 2;
  }

  update(dt: number, camera: THREE.Camera) {
    this.age += dt;
    const open = Math.min(1, this.age / 0.7);
    const ease = 1 - (1 - open) ** 3;
    this.swirlMat.uniforms.t.value = this.age;
    this.swirlMat.uniforms.open.value = ease;
    this.glowMat.uniforms.open.value = ease;
    this.gate.scale.set(0.2 + ease * 0.8, ease, 1);
    // Face the camera, turning only about the vertical.
    const c = camera.position;
    this.gate.rotation.y = Math.atan2(c.x - this.group.position.x, c.z - this.group.position.z);
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const a = this.seeds[i * 3] + this.age * 0.8;
      const k = (this.seeds[i * 3 + 1] + this.age * this.seeds[i * 3 + 2] * 0.4) % 1;
      const r = (0.75 - k * 0.45) * ease;
      pos.setXYZ(i, Math.cos(a) * r, k * 2.6, Math.sin(a) * r);
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.swirlMat.dispose();
    this.glowMat.dispose();
    this.motes.geometry.dispose();
  }
}
