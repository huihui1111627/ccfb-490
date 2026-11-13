import { Mat4, Vec3, makeOBB, OBB } from '../core/math';
import { MergePiece, MergedMesh, mergePieces } from './geometry';
import { Assembly, PartInstance } from './types';
import { assemblyGeometries, Placement } from './assembly';

export interface BakedPart {
  part: PartInstance;
  obb: OBB;
  /** 爆炸视图变换矩阵 */
  exploded: Mat4;
}

export interface BakedScene {
  mesh: MergedMesh;
  parts: BakedPart[];
  /** 组装总高、最大出跳,用于相机取景 */
  height: number;
  reach: number;
  buildMs: number;
}

/** 计算实例在爆炸视图下的变换:逐层抬升 + 沿径向水平分离 */
export function explodeMatrix(part: PartInstance, amount: number): Mat4 {
  const lift = part.layer * amount * 0.6;
  const spread = amount * 0.9;
  const dx = part.radial[0] * spread * (part.layer * 0.35 + 0.2);
  const dy = part.radial[1] * spread * (part.layer * 0.35 + 0.2);
  return Mat4.multiply(Mat4.translation(dx, dy, lift), part.matrix);
}

export function bakeAssembly(assembly: Assembly, explode = 0): BakedScene {
  const t0 = performance.now();
  const placements = assemblyGeometries(assembly.params);
  const pieces: MergePiece[] = [];
  const baked: BakedPart[] = [];
  let height = 0, reach = 0;

  assembly.parts.forEach((part, i) => {
    const pl: Placement | undefined = placements[i];
    if (!pl) return;
    const matrix = explode > 0 ? explodeMatrix(part, explode) : part.matrix;
    pieces.push({ geo: pl.geo.geo, matrix, material: part.material });
    const half: Vec3 = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2];
    const obb = makeOBB([0, 0, 0], half, matrix);
    baked.push({ part, obb, exploded: matrix });
    // 取景范围:世界 AABB 粗估
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [0, 1]) {
      const wp = matrix.transformPoint([sx * half[0], sy * half[1], sz * half[2]]);
      height = Math.max(height, wp[2]);
      reach = Math.max(reach, Math.hypot(wp[0], wp[1]));
    }
  });

  const mesh = mergePieces(pieces);
  return { mesh, parts: baked, height, reach, buildMs: performance.now() - t0 };
}
