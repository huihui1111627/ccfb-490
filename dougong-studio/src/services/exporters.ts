import { MergedMesh } from '../dougong/geometry';
import { Assembly } from '../dougong/types';

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 合并网格导出 OBJ(世界坐标,顶点按组划分,材质名写入 usemtl) */
export function exportOBJ(mesh: MergedMesh, name: string): void {
  const lines: string[] = [`# 清式斗拱参数化建模系统导出`, `o ${name}`];
  const v = mesh.positions, uv = mesh.uvs;
  for (let i = 0; i < v.length; i += 3) lines.push(`v ${v[i].toFixed(3)} ${v[i + 1].toFixed(3)} ${v[i + 2].toFixed(3)}`);
  for (let i = 0; i < uv.length; i += 2) lines.push(`vt ${uv[i].toFixed(5)} ${uv[i + 1].toFixed(5)}`);
  let base = 0;
  for (const grp of mesh.groups) {
    lines.push(`g ${grp.material}`, `usemtl ${grp.material}`);
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      const a = mesh.indices[i] + 1, b = mesh.indices[i + 1] + 1, c = mesh.indices[i + 2] + 1;
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
    }
    base += grp.count;
  }
  download(`${name}.obj`, lines.join('\n'), 'text/plain;charset=utf-8');
}

/** 构件清单导出 CSV(含斗口份数、实际毫米尺寸、数量) */
export function exportCSV(assembly: Assembly): void {
  const rows: string[][] = [
    ['序号', '构件名称', '类型', '规格(斗口份)', '长mm', '宽mm', '高mm', '数量'],
  ];
  const tally = new Map<string, { part: Assembly['parts'][number]; count: number }>();
  for (const p of assembly.parts) {
    const key = `${p.name}|${p.spec}`;
    const cur = tally.get(key);
    if (cur) cur.count++;
    else tally.set(key, { part: p, count: 1 });
  }
  let idx = 1;
  for (const [, entry] of tally) {
    const p = entry.part;
    rows.push([
      String(idx++), p.name, p.kind, p.spec,
      p.size[0].toFixed(2), p.size[1].toFixed(2), p.size[2].toFixed(2), String(entry.count),
    ]);
  }
  rows.push([]);
  rows.push(['斗口 d (mm)', String(assembly.params.doukou), '踩数', String(assembly.params.cai)]);
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`斗拱构件清单_${assembly.params.cai}踩_${assembly.params.doukou}mm.csv`, csv, 'text/csv;charset=utf-8');
}
