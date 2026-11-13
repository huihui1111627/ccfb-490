import {
  addBox, addLoftX, addNotchedBox, addPlanExtrusion, createRaw, LoftStation, RawGeometry,
} from './geometry';
import { Vec3 } from '../core/math';
import {
  ANG_LEN, BANDOUKOU, DOU_H, GUA_LEN, SHENG_H, XIANG_LEN, WAN_LEN, ZHENGXIN_W, ZUCAI,
  angLength, barHeight, qiaoLength,
} from './dims';
import { PartKind } from './types';

export interface PartGeometry {
  geo: RawGeometry;
  size: Vec3; // 全尺寸(mm)
}

/**
 * 斗/升类:方形斗身 + 十字口(底口承接翘拱,顶口承上一层构件)。
 * 槽口直接由分块盒体拼出,实体之间零穿插。
 */
export function buildBlock(opts: {
  planX: number; planY: number; height: number;
  topSlotW: number; bottomSlotW: number;
  topAxis: 'x' | 'y' | 'cross'; botAxis: 'x' | 'y' | 'cross';
}): PartGeometry {
  const { planX, planY, height, topSlotW, bottomSlotW } = opts;
  const topDepth = height * 0.4;
  const botDepth = height * 0.4;
  const g = createRaw();
  // 十字口 = x 向通槽 + y 向通槽各做一次分块(两次切槽的公共中部由中段盒自然保留)
  addNotchedBox(g, {
    length: planX, width: planY, height,
    topSlot: opts.topAxis === 'x' || opts.topAxis === 'cross'
      ? { axis: 'x', crossWidth: topSlotW, depth: topDepth } : null,
    bottomSlot: opts.botAxis === 'x' || opts.botAxis === 'cross'
      ? { axis: 'x', crossWidth: bottomSlotW, depth: botDepth } : null,
  });
  if (opts.topAxis === 'cross' || opts.botAxis === 'cross') {
    addNotchedBox(g, {
      length: planX, width: planY, height,
      topSlot: opts.topAxis === 'cross' ? { axis: 'y', crossWidth: topSlotW, depth: topDepth } : null,
      bottomSlot: opts.botAxis === 'cross' ? { axis: 'y', crossWidth: bottomSlotW, depth: botDepth } : null,
    });
  }
  return { geo: g, size: [planX, planY, height] };
}

/** 卷杀端头平面点(双侧对称):端头抹四瓣、四角圆顺 */
function juanshaPoints(totalLen: number, width: number): Vec3[] {
  const hx = totalLen / 2, hy = width / 2;
  const r = width * 0.22;          // 端头圆角
  const taper = width * 0.12;      // 瓣间收分
  const straight = hx - width * 0.55;
  const pts: Vec3[] = [];
  const push = (x: number, y: number) => pts.push([x, y, 0]);
  push(-straight, -hy);
  push(straight, -hy);
  // 右端:直线 + 两段弧
  push(hx - r, -hy + taper);
  arc(hx - r, -hy + r + taper * 0.2, r, -Math.PI / 2, 0, 4, push);
  arc(hx - r, hy - r, r, 0, Math.PI / 2, 4, push);
  push(straight, hy);
  push(-straight, hy);
  push(-hx + r, hy - taper);
  arc(-hx + r, hy - r, r, Math.PI / 2, Math.PI, 4, push);
  arc(-hx + r, -hy + r - taper * 0.2, r, Math.PI, Math.PI * 1.5, 4, push);
  return ccw(pts);
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number,
  push: (x: number, y: number) => void): void {
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
}

function ccw(pts: Vec3[]): Vec3[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area < 0 ? pts.reverse() : pts;
}

export interface BarOpts {
  kind: PartKind;
  jump?: number;
  zhengxin?: boolean;
  customLen?: number;
  customWidth?: number;
  /** 同层十字相交构件宽度,用于半榫槽口 */
  crossWidth?: number;
  slotBoth?: boolean; // 上下都开槽(同层十字相交)
}

/** 翘 / 瓜拱 / 万拱 / 厢拱 / 枋 —— 卷杀端头的直身构件 */
export function buildStraightBar(d: number, o: BarOpts): PartGeometry {
  const zhengxin = o.zhengxin ?? false;
  const lenFen = o.customLen
    ?? (o.kind === 'qiao' ? qiaoLength(o.jump ?? 1)
      : o.kind === 'guagong' ? GUA_LEN
        : o.kind === 'wangong' ? WAN_LEN
          : o.kind === 'xianggong' ? XIANG_LEN : GUA_LEN);
  const hFen = barHeight(o.kind);
  const wFen = o.customWidth ?? (zhengxin ? ZHENGXIN_W : BANDOUKOU);
  const len = lenFen * d, h = hFen * d, w = wFen * d;
  const cross = (o.crossWidth ?? wFen) * d;
  const g = createRaw();
  const halfDepth = h * 0.25;
  const poly = juanshaPoints(len, w);
  addPlanExtrusion(g, poly, 0, h);
  // 半榫槽口:在拉伸体之上叠出槽两侧边块(等效 U 形断面)
  if (o.slotBoth) {
    const side = w - cross;
    if (side > 1e-6) {
      const sw = side / 2;
      for (const sy of [-1, 1]) {
        addBox(g, 0, sy * (cross / 2 + sw / 2), h - halfDepth / 2, len * 0.98, sw, halfDepth);
        addBox(g, 0, sy * (cross / 2 + sw / 2), halfDepth / 2, len * 0.98, sw, halfDepth);
      }
    }
  }
  return { geo: g, size: [len, w, h] };
}

/** 昂:昂身矩形放样 + 昂嘴斜杀(凤凰台/菊花头简化为端部斜面) */
export function buildAng(d: number, jump: number, widthFen: number, crossWidth: number): PartGeometry {
  const lenFen = angLength(jump);
  const len = lenFen * d, h = ZUCAI * d, w = widthFen * d;
  const beak = 2.2 * d;      // 昂嘴水平投影
  const drop = 0.9 * d;      // 昂嘴下垂
  const half = len / 2;
  const stations: LoftStation[] = [
    { x: -half, halfW: w / 2, z0: 0, z1: h },
    { x: half - beak, halfW: w / 2, z0: 0, z1: h },
    { x: half, halfW: w * 0.28, z0: drop, z1: h * 0.55 },
  ];
  const g = createRaw();
  addLoftX(g, stations);
  // 顶/底半榫口(与同层横拱十字相交)
  const cross = crossWidth * d;
  const side = w - cross;
  if (side > 1e-6) {
    const sw = side / 2, hd = h * 0.25;
    for (const sy of [-1, 1]) {
      addBox(g, 0, sy * (cross / 2 + sw / 2), h - hd / 2, (len - beak) * 0.96, sw, hd);
      addBox(g, 0, sy * (cross / 2 + sw / 2), hd / 2, (len - beak) * 0.96, sw, hd);
    }
  }
  return { geo: g, size: [len, w, h] };
}

export function buildZuoDou(d: number): PartGeometry {
  return buildBlock({
    planX: 3 * d, planY: 3 * d, height: DOU_H * d,
    topSlotW: 1.04 * d, bottomSlotW: 1.04 * d,
    topAxis: 'cross', botAxis: 'cross',
  });
}

export function buildShibaDou(d: number, slotW: number): PartGeometry {
  return buildBlock({
    planX: 1.8 * d, planY: 1.48 * d, height: SHENG_H * d,
    topSlotW: slotW * d, bottomSlotW: slotW * d,
    topAxis: 'x', botAxis: 'x',
  });
}

export function buildSheng(d: number, zhengxin: boolean, barSlotW: number): PartGeometry {
  return buildBlock({
    planX: 1.3 * d, planY: (zhengxin ? 1.72 : 1.48) * d, height: SHENG_H * d,
    topSlotW: barSlotW * d, bottomSlotW: barSlotW * d,
    topAxis: 'y', botAxis: 'y',
  });
}

/** 枋:通长矩形条,正心枋带拱垫板加厚 */
export function buildFang(d: number, lengthFen: number, zhengxin: boolean): PartGeometry {
  const g = createRaw();
  const len = lengthFen * d, h = 2 * d, w = (zhengxin ? ZHENGXIN_W : 1) * d;
  addNotchedBox(g, { length: len, width: w, height: h });
  return { geo: g, size: [len, w, h] };
}

export const KIND_DEFAULT_LEN: Record<PartKind, number> = {
  zuodou: 3, qiao: 11, ang: ANG_LEN[0], guagong: GUA_LEN, wangong: WAN_LEN,
  xianggong: XIANG_LEN, sheng: 1.48, shibadou: 1.8, fang: 12, liang: 6,
};
