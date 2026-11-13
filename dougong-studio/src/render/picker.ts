import { Ray, rayOBB } from '../core/math';
import { BakedPart } from '../dougong/mesh';

/** CPU 射线 vs OBB 拾取,返回最近实例 id 与距离 */
export function pick(ray: Ray, parts: BakedPart[]): { id: number; distance: number } | null {
  let best: { id: number; distance: number } | null = null;
  for (const bp of parts) {
    const t = rayOBB(ray, bp.obb);
    if (Number.isFinite(t) && (!best || t < best.distance)) best = { id: bp.part.id, distance: t };
  }
  return best;
}
