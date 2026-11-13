import { Mat4 } from '../../core/math';
import { mergePieces, MergedMesh } from '../../dougong/geometry';
import {
  buildAng, buildFang, buildShibaDou, buildSheng, buildStraightBar, buildZuoDou, PartGeometry,
} from '../../dougong/builders';
import { GUA_LEN, WAN_LEN, XIANG_LEN, angLength, qiaoLength, jumpsOf } from '../../dougong/dims';
import { PartKind } from '../../dougong/types';
import { Viewport } from '../../render/viewport';
import { store } from '../../state/store';
import { h, statBar } from '../dom';

interface LibEntry {
  kind: PartKind;
  label: string;
  desc: string;
  build: (d: number) => PartGeometry;
}

const ENTRIES: LibEntry[] = [
  { kind: 'zuodou', label: '坐斗', desc: '3d×3d×2d,十字口承头翘', build: (d) => buildZuoDou(d) },
  { kind: 'qiao', label: '翘(头翘)', desc: '长 7d、足材 2d,卷杀端头', build: (d) => buildStraightBar(d, { kind: 'qiao', jump: 1 }) },
  { kind: 'ang', label: '昂(头昂)', desc: '长 13d,昂嘴斜杀下垂', build: (d) => buildAng(d, 1, 1, 1.24) },
  { kind: 'guagong', label: '瓜拱', desc: '长 6.2d,单材 1.4d', build: (d) => buildStraightBar(d, { kind: 'guagong' }) },
  { kind: 'wangong', label: '万拱', desc: '长 9.2d,足材 2d', build: (d) => buildStraightBar(d, { kind: 'wangong' }) },
  { kind: 'xianggong', label: '厢拱', desc: '长 7.2d,单材,最外跳', build: (d) => buildStraightBar(d, { kind: 'xianggong' }) },
  { kind: 'sheng', label: '三才升 / 槽升子', desc: '1.3d 见方,1d 高', build: (d) => buildSheng(d, false, 1) },
  { kind: 'shibadou', label: '十八斗', desc: '1.8d×1.48d×1d', build: (d) => buildShibaDou(d, 1) },
  { kind: 'fang', label: '枋', desc: '正心枋/拽枋/挑檐枋', build: (d) => buildFang(d, 12, true) },
];

export function renderLibraryPage(root: HTMLElement, viewport: Viewport, canvas: HTMLCanvasElement): void {
  root.innerHTML = '';
  const panel = h('div', 'panel');
  panel.append(h('h3', '', '斗口构件库'));
  const list = h('div', 'part-list');
  let active = 0;

  const showPart = (idx: number) => {
    active = idx;
    const e = ENTRIES[idx];
    const d = store.get().doukou;
    const geo = e.build(d);
    const mesh: MergedMesh = mergePieces([{ geo: geo.geo, matrix: Mat4.identity(), material: 'wood' }]);
    viewport.renderer.uploadMesh(mesh);
    viewport.loadHall(mesh, [], Math.max(...geo.size) * 0.8, [0, 0, geo.size[2] / 2]);
    viewport.setHallPieces([]);
    [...list.children].forEach((c, i) => c.classList.toggle('selected', i === idx));
    stats.replaceChildren();
    stats.append(statBar([
      ['构件', e.label],
      ['斗口', `${d}mm`],
      ['长×宽×高', geo.size.map((x: number) => x.toFixed(1)).join('×')],
    ]));
  };

  ENTRIES.forEach((e, i) => {
    const row = h('div', 'part-row');
    row.innerHTML = `<div><b>${e.label}</b><br><small>${e.desc}</small></div>`;
    row.addEventListener('click', () => showPart(i));
    list.append(row);
  });
  panel.append(list);

  const dimBox = h('section');
  dimBox.append(h('h3', '', '份数 → 毫米换算'));
  const table = h('table');
  table.innerHTML = `<thead><tr><th>构件</th><th>长度(份)</th><th>实际 mm</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody')!;
  const d = store.get().doukou;
  const rows: [string, number][] = [
    ['头翘', qiaoLength(1)], ['二翘', qiaoLength(2)], ['头昂', angLength(1)],
    ['瓜拱', GUA_LEN], ['厢拱', XIANG_LEN], ['万拱', WAN_LEN],
  ];
  for (const [name, fen] of rows) {
    const tr = h('tr');
    tr.innerHTML = `<td>${name}</td><td>${fen}d</td><td>${(fen * d).toFixed(2)}</td>`;
    tbody.append(tr);
  }
  dimBox.append(table);
  panel.append(dimBox);

  const tip = h('section', '', `<h3>清式斗口制</h3>
    <p style="font-size:12px;color:var(--muted);line-height:1.8">
    所有构件以斗口 d 为基本模数:足材高 2d、单材高 1.4d、拽架 3d。
    当前模型出跳 ${jumpsOf(store.get().cai)} 跳(${store.get().cai}踩),
    修改顶部斗口后构件全部按份线性缩放,尺寸误差仅来自浮点舍入(&lt;0.01mm)。</p>`);
  panel.append(tip);

  const stats = h('div');
  const stageWrap = h('div', 'stage');
  stageWrap.append(canvas, stats);
  const layout = h('div', 'page');
  layout.append(stageWrap, panel);
  root.append(layout);
  // 等两帧确保 canvas 完成布局、viewport.resize() 拿到真实尺寸后再载入构件
  requestAnimationFrame(() => requestAnimationFrame(() => showPart(active)));
}
