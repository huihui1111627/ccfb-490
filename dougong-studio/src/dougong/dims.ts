import { Cai, KeType, PartKind } from './types';

/**
 * 清式《工程做法则例》斗口制尺寸表。
 * 表中数值均为斗口 d 的倍数(足材 2d、单材 1.4d、拽架 3d 等),
 * 生成阶段乘以实际斗口毫米数,保证按 d 线性缩放、尺寸可复算。
 */

export const ZHUAJIA = 3;        // 一拽架 = 3d
export const DOU_H = 2;          // 坐斗高
export const SHENG_H = 1;        // 十八斗/三才升高
export const DANCAI = 1.4;       // 单材高(瓜拱、厢拱)
export const ZUCAI = 2;          // 足材高(翘、昂、万拱、正心构件)
export const BANDOUKOU = 1;      // 单材宽 1d;足材正心件宽 1.24d(含拱垫板)
export const ZHENGXIN_W = 1.24;

/** 翘/昂长度(份,d 倍数),index=跳序(1 起) */
const QIAO_LEN = [7, 11, 15, 19]; // 头翘 7d、二翘 11d、三翘 15d、四翘 19d
export const ANG_LEN = [13, 17, 21]; // 头昂 13d、二昂 17d、三昂 21d

export function qiaoLength(jump: number): number {
  return QIAO_LEN[Math.min(jump - 1, QIAO_LEN.length - 1)];
}
export function angLength(jump: number): number {
  return ANG_LEN[Math.min(jump - 1, ANG_LEN.length - 1)];
}
/** 横拱定长 */
export const GUA_LEN = 6.2;   // 瓜拱
export const WAN_LEN = 9.2;   // 万拱
export const XIANG_LEN = 7.2; // 厢拱

/** 斗/升平面尺寸 */
export const ZUODOU_PLAN = 3;   // 坐斗 3d × 3d
export const SHIBADOU_PLAN = 1.8;
export const SANCAI_PLAN = 1.3; // 三才升 1.3d × 1.48d
export const SANCAI_Y = 1.48;
export const CAOSHENG_PLAN = 1.3;
export const CAOSHENG_Y = 1.72; // 槽升子(正心,含拱垫板厚)

/** 翘昂拱的高度与宽度(份) */
export function barHeight(kind: PartKind): number {
  return kind === 'guagong' || kind === 'xianggong' ? DANCAI : ZUCAI;
}
export function barWidth(kind: PartKind, zhengxin: boolean): number {
  if (zhengxin) return ZHENGXIN_W;
  return kind === 'guagong' || kind === 'xianggong' || kind === 'wangong' ? BANDOUKOU : 1;
}

/** 柱头科翘昂宽度逐跳加宽(承梁需要),份 */
export function zhutouWidth(jump: number): number {
  return 2 + (jump - 1) * 0.5; // 2d、2.5d、3d、3.5d
}

/** 角科斜构件宽度 */
export const JIAO_XIE_W = 1.5;

/** 出跳数 n:三踩 n=1 … 九踩 n=4 */
export function jumpsOf(cai: Cai): number {
  return (cai - 1) / 2;
}

/** 斗口制构件命名 */
export function partName(kind: PartKind, jump = 0, axis: 'x' | 'y' | 'diag' = 'x', zhengxin = false): string {
  const cn: Record<PartKind, string> = {
    zuodou: '坐斗',
    qiao: jump ? `${['', '头', '二', '三', '四'][jump]}翘` : '翘',
    ang: `${['', '头', '二', '三'][jump]}昂`,
    guagong: zhengxin ? '正心瓜拱' : '瓜拱',
    wangong: zhengxin ? '正心万拱' : '万拱',
    xianggong: '厢拱',
    sheng: zhengxin ? '槽升子' : '三才升',
    shibadou: '十八斗',
    fang: '枋',
    liang: '耍头/梁头',
  };
  const dir = axis === 'diag' ? '斜' : axis === 'y' ? '横' : '';
  return `${dir}${cn[kind]}`;
}

/** 规格描述:把份数换算成实际毫米并保留 0.01mm */
export function specText(fen: number, d: number): string {
  return `${fen}d = ${(fen * d).toFixed(2)}mm`;
}

export function keName(ke: KeType): string {
  return ke === 'pingshen' ? '平身科' : ke === 'zhutou' ? '柱头科' : '角科';
}
