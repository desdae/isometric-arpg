import * as THREE from 'three';

/**
 * Gives a character a faint glowing silhouette that shows only where it is
 * hidden behind something (a house, a wall), so the hero never gets lost
 * behind buildings. Each mesh gets a twin sharing its geometry with an
 * inverted depth test.
 *
 * Draw order does the masking: the world draws first, then the twins (which
 * pass only where world geometry is in front), then the hero itself. Because
 * the hero isn't in the depth buffer yet when the twins draw, parts hidden
 * behind other parts of the hero (a torso inside its pauldrons) don't glow.
 * The twins stay in the opaque queue to keep that order; custom blending
 * still lets them be see-through.
 */
export function addSilhouette(root: THREE.Object3D, color = new THREE.Color(1.0, 0.62, 0.32)) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    opacity: 0.13,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    fog: false,
  });
  // Pull each twin vertex 0.35 m toward the camera along its view ray: the
  // screen position stays put, but the glow now needs an occluder clearly in
  // front, so feet dipping a centimetre into the ground don't light up.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      mvPosition.xyz -= normalize( mvPosition.xyz ) * 0.35;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) meshes.push(m);
  });
  for (const m of meshes) {
    if (!(m.material as THREE.Material).visible) continue;
    m.renderOrder = 2;
    const twin = new THREE.Mesh(m.geometry, mat);
    twin.renderOrder = 1;
    twin.castShadow = false;
    twin.receiveShadow = false;
    twin.userData.dynamic = true;
    m.add(twin);
  }
}
