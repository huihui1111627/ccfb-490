import { Mat4, Vec3 } from '../core/math';
import {
  BANDOUKOU, DOU_H, GUA_LEN, SHENG_H, WAN_LEN, XIANG_LEN, ZHENGXIN_W, ZHUAJIA,
  barHeight, jumpsOf, keName, partName, qiaoLength, specText, zhutouWidth,
} from './dims';
import {
  PartGeometry, buildAng, buildFang, buildShibaDou, buildSheng,
  buildStraightBar, buildZuoDou,
} from './builders';
import { Assembly, AssemblyParams, Cai, KeType, MaterialId, PartInstance, PartKind } from './types';

/** 搭放记录:几何在物化阶段统一生成,组装阶段只做定位与尺寸决策 */
export interface Placement {
  kind: PartKind;
  name: string;
  size: Vec3;
  matrix: Mat4;
  material: MaterialId;
  layer: number;
  radial: Vec3;
  spec: string;
  geo: PartGeometry;
}

interface Ctx {
  d: number;
  cai: Cai;
  ke: KeType;
  n: number;
  parts: Placement[];
  seq: number;
}

const BAR_H = (kind: PartKind) => barHeight(kind);
const barWFen = (_kind: PartKind, zx: boolean) => (zx ? ZHENGXIN_W : BANDOUKOU);

function place(ctx: Ctx, _kind: PartKind, name: string, geo: PartGeometry, pos: Vec3,
  rotZ: number, layer: number, radial: Vec3, spec: string, material: MaterialId = 'wood'): Placement {
  const half: Vec3 = [geo.size[0] / 2, geo.size[1] / 2, geo.size[2] / 2];
  const matrix = Mat4.multiply(
    Mat4.translation(pos[0], pos[1], pos[2]),
    Mat4.multiply(Mat4.rotationZ(rotZ), Mat4.translation(-half[0], -half[1], 0)),
  );
  const p: Placement = {
    kind: _kind, name, size: geo.size, matrix, material, layer,
    radial: [radial[0] * (pos[0] >= 0 ? 1 : -1), radial[1], radial[2]],
    spec, geo,
  };
  ctx.parts.push(p);
  return p;
}

/** Y 向(横)构件:绕 z 转 90°,局部 x 轴映射到世界 y 轴 */
function placeY(ctx: Ctx, kind: PartKind, geo: PartGeometry, x: number, z: number,
  layer: number, name: string, spec: string, radial: Vec3, material?: MaterialId): Placement {
  // 旋转后局部 x -> 世界 -y… 用 -90° 使局部 +x -> 世界 +y
  const half: Vec3 = [geo.size[0] / 2, geo.size[1] / 2, geo.size[2] / 2];
  const rot = -Math.PI / 2;
  const local = Mat4.multiply(Mat4.rotationZ(rot), Mat4.translation(-half[0], -half[1], 0));
  const matrix = Mat4.multiply(Mat4.translation(x, 0, z), local);
  const p: Placement = {
    kind, name, size: geo.size, matrix, material: material ?? 'wood', layer, radial, spec, geo,
  };
  ctx.parts.push(p);
  return p;
}

function slotWidthOf(kind: PartKind, zx: boolean): number {
  return barWFen(kind, zx);
}

// ───────────────────────── 平身科 ─────────────────────────

function buildPingshen(ctx: Ctx): void {
  const d = ctx.d, n = ctx.n;
  // 坐斗:顶面 z=2d
  place(ctx, 'zuodou', partName('zuodou'), buildZuoDou(d), [0, 0, 0], 0, 0, [0, 0, 0],
    `3d × 3d × 2d = ${(3 * d).toFixed(2)}mm`);

  let z = DOU_H * d; // 当前层构件底面
  for (let k = 1; k <= n; k++) {
    const layer = k * 2 - 1;
    const isOutermost = k === n;
    // —— 纵向层(x 向):头翘 / 二翘… 与 头昂 / 二昂…;最外跳改厢拱 ——
    const xKind: PartKind = isOutermost ? 'xianggong' : k <= 2 ? 'qiao' : 'ang';
    let xGeo: PartGeometry;
    let xLenFen: number;
    if (xKind === 'xianggong') {
      xLenFen = XIANG_LEN;
      xGeo = buildStraightBar(d, { kind: 'xianggong', customLen: XIANG_LEN });
    } else if (xKind === 'qiao') {
      xLenFen = qiaoLength(k);
      xGeo = buildStraightBar(d, { kind: 'qiao', jump: k, crossWidth: ZHENGXIN_W, slotBoth: true });
    } else {
      xLenFen = 0; // 昂不用此值
      xGeo = buildAng(d, k - 2, BANDOUKOU, ZHENGXIN_W);
    }
    const xName = xKind === 'ang' ? partName('ang', k - 2)
      : xKind === 'qiao' ? partName('qiao', k) : partName('xianggong');
    place(ctx, xKind, xName, xGeo, [0, 0, z], 0, layer, [1, 0, 0],
      specText(xKind === 'ang' ? 13 + (k - 3) * 4 : xLenFen, d));

    // —— 横向层(y 向)与纵构件十字相交,半榫搭接 ——
    const zxGong: PartKind = k === 1 ? 'guagong' : 'wangong';
    const zxGeo = buildStraightBar(d, {
      kind: zxGong, zhengxin: true,
      crossWidth: xKind === 'ang' ? BANDOUKOU : barWFen(xKind, false), slotBoth: true,
    });
    placeY(ctx, zxGong, zxGeo, 0, z, layer, partName(zxGong, 0, 'y', true),
      specText(zxGong === 'guagong' ? GUA_LEN : WAN_LEN, d), [0, 0, 0]);

    if (!isOutermost) {
      // 出跳位置上的外跳瓜拱/万拱(左右各一)
      const gongKind: PartKind = k === 1 ? 'guagong' : 'wangong';
      const lenFen = gongKind === 'guagong' ? GUA_LEN : WAN_LEN;
      for (const s of [-1, 1]) {
        const gx = s * ZHUAJIA * k * d;
        const geo = buildStraightBar(d, { kind: gongKind, crossWidth: BANDOUKOU, slotBoth: true });
        placeY(ctx, gongKind, geo, gx, z, layer, partName(gongKind, 0, 'y'),
          specText(lenFen, d), [s, 0, 0]);
      }
    }

    // —— 升斗层 ——
    const zTop = z + BAR_H(xKind === 'ang' ? 'ang' : xKind) * d;
    // 十八斗:纵构件两端(厢拱上改三才升)
    if (!isOutermost) {
      for (const s of [-1, 1]) {
        const sx = s * ZHUAJIA * k * d;
        const slot = slotWidthOf(xKind, false);
        place(ctx, 'shibadou', partName('shibadou'), buildShibaDou(d, slot),
          [sx, 0, zTop], 0, layer + 1, [s, 0, 0],
          `1.8d × 1.48d × 1d = ${(1.8 * d).toFixed(2)}mm`);
      }
    }
    // 三才升 / 槽升子:每根横拱两端
    const gongPositions: number[] = [0];
    if (!isOutermost) gongPositions.push(-ZHUAJIA * k * d, ZHUAJIA * k * d);
    for (const gx of gongPositions) {
      const zx = gx === 0;
      const slot = barWFen(zx ? 'wangong' : 'guagong', zx);
      const geo = buildSheng(d, zx, slot);
      for (const s of [-1, 1]) {
        const armLenFen = zx ? (zxGong === 'guagong' ? GUA_LEN : WAN_LEN)
          : (isOutermost ? XIANG_LEN : zxGong === 'guagong' ? GUA_LEN : WAN_LEN);
        const sy = s * (armLenFen / 2) * d;
        place(ctx, 'sheng', partName('sheng', 0, 'y', zx), geo,
          [gx, sy, zTop], 0, layer + 1, [Math.sign(gx || s), s, 0],
          zx ? '槽升子 1.3d × 1.72d' : '三才升 1.3d × 1.48d');
      }
    }
    z = zTop + SHENG_H * d;
  }

  // —— 顶部枋子:正心枋(叠两层)、拽枋、挑檐枋 ——
  addTopFang(ctx, z);
}

function addTopFang(ctx: Ctx, z: number): void {
  const d = ctx.d, n = ctx.n;
  const stackH = 2 * d;
  const totalLen = (ZHUAJIA * n + 4) * d;
  // 正心枋两层
  for (let i = 0; i < 2; i++) {
    placeY(ctx, 'fang', buildFang(d, totalLen / d, true), 0, z + i * stackH, n * 2 + 2 + i,
      `正心枋 ${i + 1}`, `通长 ${(totalLen).toFixed(0)}mm × 1.24d × 2d`, [0, 0, 0]);
  }
  // 拽枋:每跳位置
  for (let k = 1; k < n; k++) {
    for (const s of [-1, 1]) {
      const gx = s * ZHUAJIA * k * d;
      placeY(ctx, 'fang', buildFang(d, WAN_LEN, false), gx, z, n * 2 + 2,
        '拽枋', specText(WAN_LEN, d), [s, 0, 0]);
    }
  }
  // 挑檐枋:最外跳
  for (const s of [-1, 1]) {
    const gx = s * ZHUAJIA * n * d;
    placeY(ctx, 'fang', buildFang(d, XIANG_LEN, false), gx, z, n * 2 + 2,
      '挑檐枋', specText(XIANG_LEN, d), [s, 0, 0]);
  }
}

// ───────────────────────── 柱头科 ─────────────────────────

function buildZhutou(ctx: Ctx): void {
  const d = ctx.d, n = ctx.n;
  place(ctx, 'zuodou', partName('zuodou'), buildZuoDou(d), [0, 0, 0], 0, 0, [0, 0, 0],
    '坐斗(柱头科)3d × 3d × 2d');
  let z = DOU_H * d;
  for (let k = 1; k <= n; k++) {
    const layer = k * 2 - 1;
    const isOutermost = k === n;
    const wFen = zhutouWidth(k); // 纵构件逐跳加宽
    let xGeo: PartGeometry;
    let xKind: PartKind;
    let xName: string;
    if (isOutermost) {
      xKind = 'liang';
      xGeo = buildStraightBar(d, { kind: 'xianggong', customWidth: wFen, crossWidth: ZHENGXIN_W, slotBoth: true });
      xName = '挑尖梁头';
    } else if (k <= 2) {
      xKind = 'qiao';
      xGeo = buildStraightBar(d, { kind: 'qiao', jump: k, customWidth: wFen, crossWidth: ZHENGXIN_W, slotBoth: true });
      xName = partName('qiao', k);
    } else {
      xKind = 'ang';
      xGeo = buildAng(d, k - 2, wFen, ZHENGXIN_W);
      xName = partName('ang', k - 2);
    }
    place(ctx, xKind, xName, xGeo, [0, 0, z], 0, layer, [1, 0, 0],
      `加宽至 ${wFen}d = ${(wFen * d).toFixed(2)}mm`);

    // 横拱:正心瓜/万拱,外跳拱(被加宽纵件切断,只放两侧半段用整拱平移表达端头)
    const gongKind: PartKind = k === 1 ? 'guagong' : 'wangong';
    const zxGeo = buildStraightBar(d, {
      kind: gongKind, zhengxin: true, crossWidth: wFen, slotBoth: true,
    });
    placeY(ctx, gongKind, zxGeo, 0, z, layer, partName(gongKind, 0, 'y', true),
      '正心横拱(柱头科)', [0, 0, 0]);
    if (!isOutermost) {
      for (const s of [-1, 1]) {
        const gx = s * ZHUAJIA * k * d;
        const geo = buildStraightBar(d, { kind: gongKind, crossWidth: wFen, slotBoth: true });
        placeY(ctx, gongKind, geo, gx, z, layer, partName(gongKind, 0, 'y'),
          '外跳横拱', [s, 0, 0]);
      }
    }
    const zTop = z + BAR_H(xKind === 'ang' ? 'ang' : xKind === 'liang' ? 'wangong' : xKind) * d;
    if (!isOutermost) {
      for (const s of [-1, 1]) {
        place(ctx, 'shibadou', partName('shibadou'), buildShibaDou(d, wFen),
          [s * ZHUAJIA * k * d, 0, zTop], 0, layer + 1, [s, 0, 0],
          `十八斗(随宽 ${wFen}d)`);
      }
    }
    const gongPositions = [0, ...(isOutermost ? [] : [-ZHUAJIA * k * d, ZHUAJIA * k * d])];
    for (const gx of gongPositions) {
      const zx = gx === 0;
      const geo = buildSheng(d, zx, zx ? ZHENGXIN_W : BANDOUKOU);
      const armFen = gongKind === 'guagong' ? GUA_LEN : WAN_LEN;
      for (const s of [-1, 1]) {
        place(ctx, 'sheng', partName('sheng', 0, 'y', zx), geo,
          [gx, s * (armFen / 2) * d, zTop], 0, layer + 1, [Math.sign(gx || s), s, 0],
          zx ? '槽升子' : '三才升');
      }
    }
    z = zTop + SHENG_H * d;
  }
  addTopFang(ctx, z);
}

// ───────────────────────── 角科 ─────────────────────────

function buildJiao(ctx: Ctx): void {
  const d = ctx.d, n = ctx.n;
  // 角科坐斗:3.2d 见方,带斜口
  const zuodou = buildZuoDou(d);
  place(ctx, 'zuodou', '角科坐斗', zuodou, [0, 0, 0], 0, 0, [0, 0, 0],
    '3.2d 见方(角科)');
  let z = DOU_H * d;
  const diag = Math.SQRT1_2; // 45° 方向单位分量
  for (let k = 1; k <= n; k++) {
    const layer = k * 2 - 1;
    const isOutermost = k === n;
    // 斜翘/斜昂(45°),只向外出挑,长度按 √2 倍拽架递增
    const diagKind: PartKind = isOutermost ? 'xianggong' : k <= 2 ? 'qiao' : 'ang';
    let diagGeo: PartGeometry;
    let diagName: string;
    if (diagKind === 'qiao') {
      diagGeo = buildStraightBar(d, { kind: 'qiao', jump: k, customWidth: 1.5, crossWidth: 1.5 });
      diagName = `斜${partName('qiao', k)}`;
    } else if (diagKind === 'ang') {
      diagGeo = buildAng(d, k - 2, 1.5, 1.5);
      diagName = `斜${partName('ang', k - 2)}`;
    } else {
      diagGeo = buildStraightBar(d, { kind: 'xianggong', customWidth: 1.5 });
      diagName = '斜厢拱';
    }
    const reach = ZHUAJIA * k * d; // 斜件外端在对角线上的投影
    // 半件:几何局部长 L,中心放在 reach/2 处并旋转 45°
    const rot = Math.PI / 4;
    const half: Vec3 = [diagGeo.size[0] / 2, diagGeo.size[1] / 2, 0];
    const local = Mat4.multiply(Mat4.rotationZ(rot), Mat4.translation(-half[0], -half[1], 0));
    const centerPos: Vec3 = [reach * diag * 0.5, reach * diag * 0.5, z];
    const matrix = Mat4.multiply(Mat4.translation(...centerPos), local);
    ctx.parts.push({
      kind: diagKind, name: diagName, size: diagGeo.size, matrix, material: 'wood',
      layer, radial: [diag, diag, 0], spec: `角科斜构件 宽1.5d`, geo: diagGeo,
    });

    // 贴墙两方向的 quarter 纵件(翘/昂),与斜件不重叠
    const wallKind: PartKind = isOutermost ? 'xianggong' : k <= 2 ? 'qiao' : 'ang';
    const wallGeo = wallKind === 'ang'
      ? buildAng(d, k - 2, BANDOUKOU, 1.5)
      : buildStraightBar(d, wallKind === 'qiao'
        ? { kind: 'qiao', jump: k, crossWidth: 1.5, slotBoth: true }
        : { kind: 'xianggong', crossWidth: 1.5, slotBoth: true });
    for (const wall of [0, 1] as const) {
      const r = Math.PI / 2 * wall; // 0° 沿 +x,90° 沿 +y
      const h2: Vec3 = [wallGeo.size[0] / 2, wallGeo.size[1] / 2, 0];
      const loc = Mat4.multiply(Mat4.rotationZ(r), Mat4.translation(-h2[0], -h2[1], 0));
      const c: Vec3 = wall === 0 ? [reach / 2, 0, z] : [0, reach / 2, z];
      ctx.parts.push({
        kind: wallKind,
        name: `${wall === 0 ? 'x' : 'y'}向${wallKind === 'ang' ? partName('ang', k - 2) : partName(wallKind, k)}`,
        size: wallGeo.size,
        matrix: Mat4.multiply(Mat4.translation(...c), loc),
        material: 'wood', layer, radial: wall === 0 ? [1, 0, 0] : [0, 1, 0],
        spec: '贴墙半件(角科)', geo: wallGeo,
      });
    }

    // 外跳 L 形横拱:两面各一段,端头在 x/y 拽架位置
    if (!isOutermost) {
      const gongKind: PartKind = k === 1 ? 'guagong' : 'wangong';
      const lenFen = gongKind === 'guagong' ? GUA_LEN : WAN_LEN;
      for (const wall of [0, 1] as const) {
        const geo = buildStraightBar(d, { kind: gongKind, crossWidth: BANDOUKOU, slotBoth: true });
        // 沿另一轴方向放置,中心在该墙拽架点
        const base2: Vec3 = wall === 0 ? [reach, 0, z] : [0, reach, z];
        const rot2 = wall === 0 ? -Math.PI / 2 : 0;
        const hh: Vec3 = [geo.size[0] / 2, geo.size[1] / 2, 0];
        const m = Mat4.multiply(
          Mat4.translation(...base2),
          Mat4.multiply(Mat4.rotationZ(rot2), Mat4.translation(-hh[0], -hh[1], 0)),
        );
        ctx.parts.push({
          kind: gongKind, name: `贴墙${partName(gongKind, 0, 'y')}`, size: geo.size, matrix: m,
          material: 'wood', layer, radial: wall === 0 ? [1, 0, 0] : [0, 1, 0],
          spec: specText(lenFen, d), geo,
        });
      }
    }

    // 升斗:斜件外端十八斗 + 横拱端头三才升
    const zTop = z + BAR_H(diagKind === 'ang' ? 'ang' : diagKind === 'qiao' ? 'qiao' : 'guagong') * d;
    const douGeo = buildShibaDou(d, 1.5);
    ctx.parts.push({
      kind: 'shibadou', name: '斜十八斗', size: douGeo.size,
      matrix: Mat4.translation(reach * diag - douGeo.size[0] / 2, reach * diag - douGeo.size[1] / 2, zTop),
      material: 'wood', layer: layer + 1, radial: [diag, diag, 0], spec: '斜十八斗 1.5d 口', geo: douGeo,
    });
    if (!isOutermost) {
      const shengGeo = buildSheng(d, false, BANDOUKOU);
      const armFen = k === 1 ? GUA_LEN : WAN_LEN;
      for (const wall of [0, 1] as const) {
        for (const s of [-1, 1]) {
          const base = wall === 0
            ? [reach, s * (armFen / 2) * d, zTop] as Vec3
            : [s * (armFen / 2) * d, reach, zTop] as Vec3;
          ctx.parts.push({
            kind: 'sheng', name: partName('sheng'), size: shengGeo.size,
            matrix: Mat4.translation(base[0] - shengGeo.size[0] / 2, base[1] - shengGeo.size[1] / 2, zTop),
            material: 'wood', layer: layer + 1,
            radial: [wall === 0 ? 1 : s * 0.3, wall === 1 ? 1 : s * 0.3, 0],
            spec: '三才升', geo: shengGeo,
          });
        }
      }
    }
    z = zTop + SHENG_H * d;
  }
  // 角科顶部枋:两面正心枋 + 挑檐枋
  const totalLen = (ZHUAJIA * n + 4) * d;
  for (const wall of [0, 1] as const) {
    const fang = buildFang(d, totalLen / d, true);
    const rot2 = wall === 0 ? -Math.PI / 2 : 0;
    const hh: Vec3 = [fang.size[0] / 2, fang.size[1] / 2, 0];
    const m = Mat4.multiply(Mat4.translation(wall === 0 ? 0 : 0, 0, z),
      Mat4.multiply(Mat4.rotationZ(rot2), Mat4.translation(-hh[0], -hh[1], 0)));
    ctx.parts.push({
      kind: 'fang', name: `角科正心枋(${wall === 0 ? 'y' : 'x'}向)`, size: fang.size, matrix: m,
      material: 'wood', layer: n * 2 + 2, radial: [0, 0, 0], spec: '正心枋', geo: fang,
    });
  }
}

// ───────────────────────── 入口 ─────────────────────────

export function assemble(params: AssemblyParams): Assembly {
  const ctx: Ctx = {
    d: params.doukou, cai: params.cai, ke: params.ke,
    n: jumpsOf(params.cai), parts: [], seq: 0,
  };
  if (params.ke === 'pingshen') buildPingshen(ctx);
  else if (params.ke === 'zhutou') buildZhutou(ctx);
  else buildJiao(ctx);

  const parts: PartInstance[] = ctx.parts.map((p, i) => ({
    id: i,
    kind: p.kind,
    name: p.name,
    size: p.size,
    matrix: p.matrix,
    material: p.material,
    layer: p.layer,
    radial: p.radial,
    count: 1,
    spec: p.spec,
  }));
  return { params, parts };
}

export function keLabel(ke: KeType): string {
  return keName(ke);
}

/** 组装几何快照(供网格合并/导出复用) */
export function assemblyGeometries(params: AssemblyParams): Placement[] {
  const ctx: Ctx = {
    d: params.doukou, cai: params.cai, ke: params.ke,
    n: jumpsOf(params.cai), parts: [], seq: 0,
  };
  if (params.ke === 'pingshen') buildPingshen(ctx);
  else if (params.ke === 'zhutou') buildZhutou(ctx);
  else buildJiao(ctx);
  return ctx.parts;
}
