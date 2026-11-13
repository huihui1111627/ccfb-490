// 程序化几何构建器:全部以毫米为单位,生成带法线/UV 的三角网格
import { Mat4, Vec3 } from '../core/math';

export interface RawGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export function createRaw(): RawGeometry {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** 每 256mm 对应一张程序贴图 */
export const UV_TILE_MM = 256;
const uv = (v: number): number => v / UV_TILE_MM;

interface Slot {
  /** 槽口沿哪条轴贯通;crossWidth 为垂直方向的开口宽,depth 为槽深 */
  axis: 'x' | 'y';
  crossWidth: number;
  depth: number;
}

export interface NotchedBoxOpts {
  length: number; // x
  width: number;  // y
  height: number; // z,底面 z=0
  topSlot?: Slot | null;
  bottomSlot?: Slot | null;
}

/**
 * 带槽口的盒体 —— 不用布尔运算,按 z 向分层 + 侧向分块直接拼出
 * U 形断面,保证同层十字相交构件以半榫搭接、实体互不穿插。
 */
export function addNotchedBox(b: RawGeometry, o: NotchedBoxOpts): void {
  const { length: L, width: W, height: H } = o;
  const top = o.topSlot ?? null;
  const bot = o.bottomSlot ?? null;
  const zBotCut = bot ? bot.depth : 0;
  const zTopCut = top ? top.depth : 0;

  // 1) 中段实体盒(若有底槽则抬到槽深之上)
  if (H - zBotCut - zTopCut > 1e-9) {
    addBox(b, 0, 0, zBotCut + (H - zBotCut - zTopCut) / 2, L, W, H - zBotCut - zTopCut);
  }
  // 2) 底部两侧边块
  if (bot) {
    const side = (bot.axis === 'x' ? W : L) - bot.crossWidth;
    if (side > 1e-9) {
      const sw = side / 2;
      if (bot.axis === 'x') {
        addBox(b, 0, -(bot.crossWidth / 2 + sw / 2), zBotCut / 2, L, sw, zBotCut);
        addBox(b, 0, +(bot.crossWidth / 2 + sw / 2), zBotCut / 2, L, sw, zBotCut);
      } else {
        addBox(b, -(bot.crossWidth / 2 + sw / 2), 0, zBotCut / 2, sw, W, zBotCut);
        addBox(b, +(bot.crossWidth / 2 + sw / 2), 0, zBotCut / 2, sw, W, zBotCut);
      }
    }
  }
  // 3) 顶部两侧边块
  if (top) {
    const side = (top.axis === 'x' ? W : L) - top.crossWidth;
    if (side > 1e-9) {
      const sw = side / 2;
      const z0 = H - zTopCut;
      if (top.axis === 'x') {
        addBox(b, 0, -(top.crossWidth / 2 + sw / 2), z0 + zTopCut / 2, L, sw, zTopCut);
        addBox(b, 0, +(top.crossWidth / 2 + sw / 2), z0 + zTopCut / 2, L, sw, zTopCut);
      } else {
        addBox(b, -(top.crossWidth / 2 + sw / 2), 0, z0 + zTopCut / 2, sw, W, zTopCut);
        addBox(b, +(top.crossWidth / 2 + sw / 2), 0, z0 + zTopCut / 2, sw, W, zTopCut);
      }
    }
  }
}

/** 轴对齐盒体,中心 (cx,cy,cz),全尺寸 sx/sy/sz */
export function addBox(b: RawGeometry, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const base = b.positions.length / 3;
  const corners: Vec3[] = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ];
  const n: Vec3[] = [
    [0, 0, -1], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1],
  ];
  // 每面 4 角点索引 + 面内两轴的物理尺寸(用于 UV)
  const faces: { idx: [number, number, number, number]; n: Vec3; us: number; vs: number }[] = [
    { idx: [0, 3, 2, 1], n: n[0], us: sx, vs: sy }, // -z
    { idx: [1, 2, 6, 5], n: n[1], us: sy, vs: sz }, // +x
    { idx: [2, 3, 7, 6], n: n[2], us: sx, vs: sz }, // +y
    { idx: [3, 0, 4, 7], n: n[3], us: sy, vs: sz }, // -x
    { idx: [0, 1, 5, 4], n: n[4], us: sx, vs: sz }, // -y
    { idx: [4, 5, 6, 7], n: n[5], us: sx, vs: sy }, // +z
  ];
  for (const c of corners) b.positions.push(c[0], c[1], c[2]);
  for (const f of faces) {
    const [a, c2, d, e] = f.idx;
    for (const k of [a, c2, d, e]) {
      b.normals.push(f.n[0], f.n[1], f.n[2]);
      const p = corners[k];
      // 以面中心为 UV 原点的平面投影
      b.uvs.push(uv((p[0] - cx) * (Math.abs(f.n[0]) > 0.5 ? 0 : 1) + (p[1] - cy) * (Math.abs(f.n[1]) > 0.5 ? 0 : 1)),
        uv((p[2] - cz) * (Math.abs(f.n[2]) > 0.5 ? 0 : 1) + (p[1] - cy) * (Math.abs(f.n[1]) > 0.5 ? 0 : 1)));
    }
    b.indices.push(base + a, base + c2, base + d, base + a, base + d, base + e);
  }
}

/**
 * 平面多边形(逆时针)垂直拉伸成棱柱 —— 用于拱/翘的卷杀端头。
 * polygon 为 xy 平面轮廓,z0/z1 为底/顶标高。
 */
export function addPlanExtrusion(b: RawGeometry, polygon: Vec3[], z0: number, z1: number): void {
  const n = polygon.length;
  const base = b.positions.length / 3;
  // 顶点:底环 + 顶环
  for (const p of polygon) b.positions.push(p[0], p[1], z0);
  for (const p of polygon) b.positions.push(p[0], p[1], z1);
  for (let i = 0; i < n; i++) b.normals.push(0, 0, -1);
  for (let i = 0; i < n; i++) b.normals.push(0, 0, 1);
  for (let i = 0; i < 2 * n; i++) {
    const p = b.positions;
    const vx = p[i * 3], vy = p[i * 3 + 1];
    b.uvs.push(uv(vx), uv(vy));
  }
  // 侧面(含水平法线)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = polygon[i], c = polygon[j];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;
    const s0 = b.positions.length / 3;
    b.positions.push(a[0], a[1], z0, c[0], c[1], z0, c[0], c[1], z1, a[0], a[1], z1);
    for (let k = 0; k < 4; k++) b.normals.push(nx, ny, 0);
    b.uvs.push(0, uv(z0), uv(len), uv(z0), uv(len), uv(z1), 0, uv(z1));
    b.indices.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
  }
  // 顶面扇形(凸多边形)
  const cx = polygon.reduce((s, p) => s + p[0], 0) / n;
  const cy = polygon.reduce((s, p) => s + p[1], 0) / n;
  const topCenter = b.positions.length / 3;
  b.positions.push(cx, cy, z1);
  b.normals.push(0, 0, 1);
  b.uvs.push(uv(cx), uv(cy));
  const botCenter = b.positions.length / 3;
  b.positions.push(cx, cy, z0);
  b.normals.push(0, 0, -1);
  b.uvs.push(uv(cx), uv(cy));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.indices.push(topCenter, base + n + j, base + n + i);
    b.indices.push(botCenter, base + i, base + j);
  }
}

export interface LoftStation {
  x: number;
  halfW: number; // y 向半宽
  z0: number;    // 底标高
  z1: number;    // 顶标高
}

/**
 * 沿 X 轴变截面放样(截面恒为矩形)—— 昂嘴斜杀、翘端卷瓣。
 * stations 需按 x 升序。
 */
export function addLoftX(b: RawGeometry, stations: LoftStation[]): void {
  const n = stations.length;
  if (n < 2) return;
  // 每站 4 角:0=-y底 1=+y底 2=+y顶 3=-y顶
  const ring = (s: LoftStation): Vec3[] => [
    [s.x, -s.halfW, s.z0], [s.x, s.halfW, s.z0],
    [s.x, s.halfW, s.z1], [s.x, -s.halfW, s.z1],
  ];
  const rings = stations.map(ring);
  const base = b.positions.length / 3;
  for (const r of rings) for (const p of r) b.positions.push(p[0], p[1], p[2]);
  // 法线:相邻边叉积近似(逐面计算更直观)
  const quad = (a: number, c: number, d: number, e: number, flip: boolean) => {
    const pa = [b.positions[a * 3], b.positions[a * 3 + 1], b.positions[a * 3 + 2]] as Vec3;
    const pc = [b.positions[c * 3], b.positions[c * 3 + 1], b.positions[c * 3 + 2]] as Vec3;
    const pd = [b.positions[d * 3], b.positions[d * 3 + 1], b.positions[d * 3 + 2]];
    const ux = pc[0] - pa[0], uy = pc[1] - pa[1], uz = pc[2] - pa[2];
    const vx = pd[0] - pa[0], vy = pd[1] - pa[1], vz = pd[2] - pa[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    for (let k = 0; k < 4; k++) b.normals.push(nx, ny, nz);
    b.uvs.push(uv(pa[0]), uv(pa[2]), uv(pc[0]), uv(pc[2]), uv(pd[0]), uv(pd[2]), uv(pa[0]), uv(pa[2]));
    if (flip) b.indices.push(a, d, c, a, e, d);
    else b.indices.push(a, c, d, a, d, e);
  };
  for (let i = 0; i < n - 1; i++) {
    const r0 = base + i * 4, r1 = base + (i + 1) * 4;
    quad(r0 + 0, r1 + 0, r1 + 1, r0 + 1, false); // 底
    quad(r0 + 1, r1 + 1, r1 + 2, r0 + 2, false); // +y
    quad(r0 + 2, r1 + 2, r1 + 3, r0 + 3, false); // 顶
    quad(r0 + 3, r1 + 3, r1 + 0, r0 + 0, false); // -y
  }
  // 端盖
  const cap = (si: number, sign: 1 | -1) => {
    const r = base + si * 4;
    const s = stations[si];
    const ci = b.positions.length / 3;
    b.positions.push(s.x, 0, (s.z0 + s.z1) / 2);
    b.normals.push(sign, 0, 0);
    b.uvs.push(0, 0);
    for (let k = 0; k < 4; k++) {
      const p = rings[si][k];
      b.normals.push(sign, 0, 0);
      b.uvs.push(uv(p[1]), uv(p[2]));
    }
    const idx = [r, r + 1, r + 2, r + 3];
    if (sign < 0) b.indices.push(ci, idx[0], idx[1], ci, idx[1], idx[2], ci, idx[2], idx[3]);
    else b.indices.push(ci, idx[1], idx[0], ci, idx[2], idx[1], ci, idx[3], idx[2]);
  };
  cap(0, -1);
  cap(n - 1, 1);
}

/** 圆柱(柱、檩),axis 指定轴向,center 为几何中心 */
export function addCylinder(b: RawGeometry, center: Vec3, radius: number, length: number, segments: number, axis: 'x' | 'y' | 'z'): void {
  const base = b.positions.length / 3;
  const pt = (i: number, t: number): Vec3 => {
    const ang = (i / segments) * Math.PI * 2;
    const c = Math.cos(ang) * radius, s = Math.sin(ang) * radius;
    if (axis === 'z') return [center[0] + c, center[1] + s, center[2] + t];
    if (axis === 'x') return [center[0] + t, center[1] + c, center[2] + s];
    return [center[0] + c, center[1] + t, center[2] + s];
  };
  const nrm = (i: number): Vec3 => {
    const ang = (i / segments) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    if (axis === 'z') return [c, s, 0];
    if (axis === 'x') return [0, c, s];
    return [c, 0, s];
  };
  for (let i = 0; i <= segments; i++) {
    const k = i === segments ? 0 : i;
    for (const t of [-length / 2, length / 2]) {
      const p = pt(k, t);
      b.positions.push(p[0], p[1], p[2]);
      const n = nrm(k);
      b.normals.push(n[0], n[1], n[2]);
      b.uvs.push(uv(i / segments * 2 * Math.PI * radius), uv(t + length / 2));
    }
  }
  for (let i = 0; i < segments; i++) {
    const r0 = base + i * 2, r1 = base + (i + 1) * 2;
    b.indices.push(r0, r1, r1 + 1, r0, r1 + 1, r0 + 1);
  }
  // 端盖
  for (const sign of [-1, 1] as const) {
    const ci = b.positions.length / 3;
    b.positions.push(center[0], center[1], center[2]);
    const n: Vec3 = axis === 'z' ? [0, 0, sign] : axis === 'x' ? [sign, 0, 0] : [0, sign, 0];
    b.normals.push(n[0], n[1], n[2]);
    b.uvs.push(0, 0);
    const ringStart = b.positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const p = pt(i, (sign * length) / 2);
      b.positions.push(p[0], p[1], p[2]);
      b.normals.push(n[0], n[1], n[2]);
      b.uvs.push(uv(p[0] - center[0]), uv(p[1] - center[1]));
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      if (sign > 0) b.indices.push(ci, ringStart + i, ringStart + j);
      else b.indices.push(ci, ringStart + j, ringStart + i);
    }
  }
}

/** 合并后的 GPU 网格:一个材质一段 draw range */
export interface MergedMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: { start: number; count: number; material: string }[];
  vertexCount: number;
}

export interface MergePiece {
  geo: RawGeometry;
  matrix: Mat4;
  material: string;
}

/** 把若干局部网格按实例矩阵烘焙进同一个顶点缓冲 */
export function mergePieces(pieces: MergePiece[]): MergedMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: MergedMesh['groups'] = [];
  const byMat = new Map<string, MergePiece[]>();
  for (const p of pieces) {
    const arr = byMat.get(p.material) ?? [];
    arr.push(p);
    byMat.set(p.material, arr);
  }
  for (const [material, arr] of byMat) {
    const start = indices.length;
    for (const p of arr) {
      const offset = positions.length / 3;
      const g = p.geo;
      for (let i = 0; i < g.positions.length; i += 3) {
        const wp = p.matrix.transformPoint([g.positions[i], g.positions[i + 1], g.positions[i + 2]]);
        positions.push(wp[0], wp[1], wp[2]);
      }
      for (let i = 0; i < g.normals.length; i += 3) {
        const wn = p.matrix.transformDir([g.normals[i], g.normals[i + 1], g.normals[i + 2]]);
        const l = Math.hypot(wn[0], wn[1], wn[2]) || 1;
        normals.push(wn[0] / l, wn[1] / l, wn[2] / l);
      }
      for (let i = 0; i < g.uvs.length; i++) uvs.push(g.uvs[i]);
      for (let i = 0; i < g.indices.length; i++) indices.push(g.indices[i] + offset);
    }
    groups.push({ start, count: indices.length - start, material });
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    groups,
    vertexCount: positions.length / 3,
  };
}
