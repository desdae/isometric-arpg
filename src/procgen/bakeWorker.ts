import { bakeSurfaceData, SURFACES } from './surfaces';
import type { BakeRequest } from './textures';

// Bakes one surface per message and transfers the pixel buffers back.
self.onmessage = (e: MessageEvent<BakeRequest>) => {
  const { kind, seed, size = 512, normalStrength = 6 } = e.data;
  const d = bakeSurfaceData(SURFACES[kind](seed), size, normalStrength);
  (self as unknown as Worker).postMessage(d, [d.albedo.buffer, d.normal.buffer, d.orm.buffer]);
};
