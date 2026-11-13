/**
 * Node 运行入口(显式 .ts 扩展名,供 --experimental-strip-types 使用)。
 * 核验逻辑与 smoke.ts 保持同源。
 */
declare const process: { exit(code: number): void };
import { assemble, assemblyGeometries } from '../src/dougong/assembly.ts';
import type { AssemblyParams, Cai, KeType } from '../src/dougong/types.ts';
import type { Vec3 } from '../src/core/math.ts';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
};

// 1) 斗口线性
{
  const a = assemble({ doukou: 90, cai: 9, ke: 'pingshen' });
  const b = assemble({ doukou: 100, cai: 9, ke: 'pingshen' });
  check(a.parts.length === b.parts.length, '不同斗口构件数量一致');
  let maxErr = 0;
  for (let i = 0; i < a.parts.length; i++) {
    for (let k = 0; k < 3; k++) {
      const expect = a.parts[i].size[k] * (100 / 90);
      maxErr = Math.max(maxErr, Math.abs(expect - b.parts[i].size[k]));
    }
  }
  check(maxErr < 1e-9, `尺寸随斗口严格线性(最大偏差 ${maxErr.toExponential(2)}mm)`);
}

// 2) 毫米精度
{
  const d = 77;
  const a = assemble({ doukou: d, cai: 7, ke: 'pingshen' });
  let maxErr = 0;
  for (const p of a.parts) {
    for (let k = 0; k < 3; k++) {
      maxErr = Math.max(maxErr, Math.abs(p.size[k] - Math.round(p.size[k] * 100) / 100));
    }
  }
  check(maxErr < 0.01, `所有构件尺寸舍入误差 < 0.01mm(实测 ${maxErr.toFixed(4)}mm)`);
}

// 3) 同层无实体穿插
{
  const params: AssemblyParams = { doukou: 90, cai: 9, ke: 'pingshen' };
  const placements = assemblyGeometries(params);
  const boxes = placements.map((p) => {
    const h: Vec3 = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
    const corners: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [0, 1]) {
      corners.push(p.matrix.transformPoint([sx * h[0], sy * h[1], sz * h[2]]));
    }
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c[i]); max[i] = Math.max(max[i], c[i]);
    }
    return { name: p.name, layer: p.layer, min, max };
  });
  const overlap = (aMin: number, aMax: number, bMin: number, bMax: number) =>
    Math.min(aMax, bMax) - Math.max(aMin, bMin);
  let violations = 0;
  const TOL = 0.6;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.layer !== B.layer) continue;
      const ox = overlap(A.min[0], A.max[0], B.min[0], B.max[0]);
      const oy = overlap(A.min[1], A.max[1], B.min[1], B.max[1]);
      const oz = overlap(A.min[2], A.max[2], B.min[2], B.max[2]);
      if (ox > TOL && oy > TOL && oz > TOL) {
        violations++;
        console.error(`    穿插: ${A.name} ↔ ${B.name} (x=${ox.toFixed(1)} y=${oy.toFixed(1)} z=${oz.toFixed(1)})`);
      }
    }
  }
  check(violations === 0, `同层构件无实体穿插(容差 ${TOL}mm,违规 ${violations} 处)`);
}

// 4) 全踩数 × 全科型
{
  const cais: Cai[] = [3, 5, 7, 9];
  const kes: KeType[] = ['pingshen', 'zhutou', 'jiao'];
  for (const cai of cais) {
    for (const ke of kes) {
      const a = assemble({ doukou: 90, cai, ke });
      check(a.parts.length >= 7, `${cai}踩 ${ke} 组装成功,构件 ${a.parts.length} 件`);
      const geo = assemblyGeometries({ doukou: 90, cai, ke });
      const bad = geo.filter((g) => g.geo.geo.indices.length === 0 || g.geo.geo.positions.length === 0);
      check(bad.length === 0, `${cai}踩 ${ke} 全部构件几何有效`);
    }
  }
}

// 5) 出跳量
{
  const a = assemble({ doukou: 90, cai: 5, ke: 'pingshen' });
  const maxX = Math.max(...a.parts.map((p) => {
    const wp = p.matrix.transformPoint([p.size[0] / 2, 0, 0]);
    return Math.abs(wp[0]);
  }));
  const expected = 2 * 3 * 90;
  check(Math.abs(maxX - expected) < expected * 0.4,
    `五踩出跳量接近 2 拽架 = ${expected}mm(实测 ${maxX.toFixed(0)}mm,含拱端头外伸)`);
}

console.log(failures === 0 ? '\n全部核验通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
