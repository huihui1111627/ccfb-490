// 轻量三维数学库 —— 单位均为毫米(mm)
export type Vec3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 列主序 4x4 矩阵 */
export class Mat4 {
  readonly m: Float32Array;
  constructor(m?: Float32Array | number[]) {
    this.m = new Float32Array(16);
    if (m) this.m.set(m);
  }
  static identity(): Mat4 {
    const r = new Mat4();
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1;
    return r;
  }
  static multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Mat4();
    const A = a.m, B = b.m, O = out.m;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        O[c * 4 + r] =
          A[0 * 4 + r] * B[c * 4 + 0] +
          A[1 * 4 + r] * B[c * 4 + 1] +
          A[2 * 4 + r] * B[c * 4 + 2] +
          A[3 * 4 + r] * B[c * 4 + 3];
      }
    }
    return out;
  }
  static translation(x: number, y: number, z: number): Mat4 {
    const r = Mat4.identity();
    r.m[12] = x; r.m[13] = y; r.m[14] = z;
    return r;
  }
  static rotationZ(rad: number): Mat4 {
    const c = Math.cos(rad), s = Math.sin(rad);
    const r = Mat4.identity();
    r.m[0] = c; r.m[1] = s; r.m[4] = -s; r.m[5] = c;
    return r;
  }
  static scale(sx: number, sy: number, sz: number): Mat4 {
    const r = Mat4.identity();
    r.m[0] = sx; r.m[5] = sy; r.m[10] = sz;
    return r;
  }
  static compose(pos: Vec3, rotZ: number, scl: Vec3): Mat4 {
    return Mat4.multiply(
      Mat4.translation(pos[0], pos[1], pos[2]),
      Mat4.multiply(Mat4.rotationZ(rotZ), Mat4.scale(scl[0], scl[1], scl[2])),
    );
  }
  static perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovyRad / 2);
    const r = new Mat4();
    const O = r.m;
    O[0] = f / aspect;
    O[5] = f;
    O[10] = (far + near) / (near - far);
    O[11] = -1;
    O[14] = (2 * far * near) / (near - far);
    return r;
  }
  static lookAt(eye: Vec3, target: Vec3, upHint: Vec3 = [0, 0, 1]): Mat4 {
    const f = normalize(sub(target, eye));
    const s = normalize(cross(f, upHint));
    const u = cross(s, f);
    const r = Mat4.identity();
    const O = r.m;
    O[0] = s[0]; O[4] = s[1]; O[8] = s[2];
    O[1] = u[0]; O[5] = u[1]; O[9] = u[2];
    O[2] = -f[0]; O[6] = -f[1]; O[10] = -f[2];
    O[12] = -dot(s, eye);
    O[13] = -dot(u, eye);
    O[14] = dot(f, eye);
    return r;
  }
  /** 点变换(含平移) */
  transformPoint(p: Vec3): Vec3 {
    const m = this.m;
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const inv = w === 1 ? 1 : 1 / w;
    return [
      (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * inv,
      (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * inv,
      (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * inv,
    ];
  }
  /** 方向变换(不含平移) */
  transformDir(p: Vec3): Vec3 {
    const m = this.m;
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
    ];
  }
  invert(): Mat4 {
    const m = this.m, o = new Mat4().m;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return Mat4.identity();
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return new Mat4(o);
  }
}

/** 射线,origin/direction 均世界坐标 */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** 有向包围盒(OBB),中心 + 半尺寸 + 世界变换 */
export interface OBB {
  center: Vec3;
  half: Vec3;
  matrix: Mat4; // 单位盒 -> 世界
  invMatrix: Mat4;
}

export function makeOBB(center: Vec3, half: Vec3, matrix: Mat4): OBB {
  return { center, half, matrix, invMatrix: matrix.invert() };
}

/** 射线 vs OBB(slab 法,模型空间内做 AABB 测试) */
export function rayOBB(ray: Ray, obb: OBB): number {
  const lo = obb.invMatrix.transformPoint(ray.origin);
  const ld = obb.invMatrix.transformDir(ray.dir);
  const h = obb.half;
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-10) {
      if (lo[i] < -h[i] || lo[i] > h[i]) return Infinity;
    } else {
      let t1 = (-h[i] - lo[i]) / ld[i];
      let t2 = (h[i] - lo[i]) / ld[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmax >= 0 ? Math.max(0, tmin) : Infinity;
}
