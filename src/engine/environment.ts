import * as THREE from 'three';

// Procedural image-based lighting. Metals need something to reflect, so we
// render a tiny scene (red storm sky above, black earth below, a few warm
// "fire" panels on the horizon) into a prefiltered environment map.

export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 top = vec3(0.16, 0.07, 0.065);
          vec3 horizon = vec3(0.3, 0.12, 0.09);
          vec3 ground = vec3(0.02, 0.012, 0.01);
          vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon * 0.3, ground, pow(-y, 0.4));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  );
  env.add(sky);
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.6), side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), warm);
    p.position.set(Math.cos(a) * 40, 2 + (i % 2) * 3, Math.sin(a) * 40);
    p.lookAt(0, 0, 0);
    env.add(p);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
