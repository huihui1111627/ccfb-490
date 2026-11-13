import { Mat4, Vec3 } from '../core/math';

export type KeType = 'pingshen' | 'zhutou' | 'jiao';
export type Cai = 3 | 5 | 7 | 9;
export type MaterialId = 'wood' | 'caizhua' | 'xuanzi';
export type PartKind =
  | 'zuodou'      // 坐斗(大斗)
  | 'qiao'        // 翘
  | 'ang'         // 昂
  | 'guagong'     // 瓜拱
  | 'wangong'     // 万拱
  | 'xianggong'   // 厢拱
  | 'sheng'       // 升(三才升/槽升子)
  | 'shibadou'    // 十八斗(交互斗)
  | 'fang'        // 枋(正心枋/拽枋/挑檐枋)
  | 'liang';      // 梁头/耍头类

export interface AssemblyParams {
  /** 斗口实际尺寸,毫米 */
  doukou: number;
  cai: Cai;
  ke: KeType;
}

export interface HallParams {
  bays: number;       // 面阔开间数
  depths: number;     // 进深间数
  bayWidth: number;   // 明间面阔,毫米
  depthWidth: number; // 每进进深,毫米
  columnHeight: number; // 檐柱高,毫米
  ke: KeType;
  cai: Cai;
  doukou: number;
}

export interface PartInstance {
  id: number;
  kind: PartKind;
  name: string;
  /** 包围盒全尺寸,毫米 */
  size: Vec3;
  /** 世界/组装局部变换 */
  matrix: Mat4;
  material: MaterialId;
  /** 爆炸视图沿 z 抬升量与水平径向偏移系数 */
  layer: number;
  radial: Vec3;
  count: number;
  spec: string; // 斗口倍数描述
}

export interface Assembly {
  params: AssemblyParams;
  parts: PartInstance[];
}

export interface SavedScheme {
  id: string;
  name: string;
  createdAt: number;
  note: string;
  assembly: AssemblyParams;
  hall: Omit<HallParams, 'doukou' | 'cai' | 'ke'>;
}
