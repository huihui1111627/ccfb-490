import { SavedScheme } from '../dougong/types';

const KEY = 'dougong-studio-schemes-v1';

export function loadSchemes(): SavedScheme[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedScheme[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveScheme(scheme: SavedScheme): SavedScheme[] {
  const all = loadSchemes();
  all.unshift(scheme);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
  return all.slice(0, 50);
}

export function deleteScheme(id: string): SavedScheme[] {
  const all = loadSchemes().filter((s) => s.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export interface DiffEntry {
  field: string;
  a: string;
  b: string;
  changed: boolean;
}

/** 两版方案参数级对比 */
export function diffSchemes(a: SavedScheme, b: SavedScheme): DiffEntry[] {
  const row = (field: string, x: string | number, y: string | number): DiffEntry => ({
    field, a: String(x), b: String(y), changed: String(x) !== String(y),
  });
  return [
    row('斗口 d (mm)', a.assembly.doukou, b.assembly.doukou),
    row('踩数', `${a.assembly.cai}踩`, `${b.assembly.cai}踩`),
    row('科型', a.assembly.ke, b.assembly.ke),
    row('面阔开间', a.hall.bays, b.hall.bays),
    row('进深间数', a.hall.depths, b.hall.depths),
    row('明间面阔 (mm)', a.hall.bayWidth, b.hall.bayWidth),
    row('进深 (mm)', a.hall.depthWidth, b.hall.depthWidth),
    row('檐柱高 (mm)', a.hall.columnHeight, b.hall.columnHeight),
  ];
}

export function newSchemeId(): string {
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
}
