import { Viewport } from '../../render/viewport';
import { store } from '../../state/store';
import { assemble } from '../../dougong/assembly';
import { checkbox, field, h, pageLayout, select, slider, statBar } from '../dom';
import { keName } from '../../dougong/dims';
import { KeType } from '../../dougong/types';

export function renderAssemblyPage(root: HTMLElement, viewport: Viewport, canvas: HTMLCanvasElement): void {
  root.innerHTML = '';
  const s = store.get();
  const panel = h('div', 'panel');

  // —— 参数区 ——
  panel.append(h('h3', '', '组装参数'));
  const keSel = select([
    ['pingshen', '平身科'], ['zhutou', '柱头科'], ['jiao', '角科'],
  ], s.ke);
  keSel.addEventListener('change', () => {
    store.patch({ ke: keSel.value as KeType, selectedId: -1 });
    rebuild();
  });
  panel.append(field('科型', keSel));

  const wire = checkbox('线框模式', s.wireframe);
  wire.querySelector('input')!.addEventListener('change', (e) =>
    store.patch({ wireframe: (e.target as HTMLInputElement).checked }));
  const ao = checkbox('环境光遮蔽 SSAO', s.ssao);
  ao.querySelector('input')!.addEventListener('change', (e) =>
    store.patch({ ssao: (e.target as HTMLInputElement).checked }));
  const sh = checkbox('阴影 PCF', s.shadows);
  sh.querySelector('input')!.addEventListener('change', (e) =>
    store.patch({ shadows: (e.target as HTMLInputElement).checked }));
  panel.append(wire, ao, sh);

  panel.append(h('h3', '', '爆炸视图'));
  const exp = slider(s.explode, 0, 1, 0.01);
  exp.addEventListener('input', () => {
    store.patch({ explode: Number(exp.value) });
    rebuild();
  });
  panel.append(exp);

  // —— 构件清单(可点击高亮)——
  panel.append(h('h3', '', '构件清单(点击高亮)'));
  const list = h('div', 'part-list');
  panel.append(list);

  const stats = h('div');
  const layout = pageLayout(canvas, panel);
  layout.querySelector('.stage')!.append(stats);
  root.append(layout);

  function rebuild(): void {
    const ms = viewport.loadAssembly();
    const assembly = assemble(store.assemblyParams());
    list.innerHTML = '';
    const groups = new Map<string, number>();
    for (const p of assembly.parts) groups.set(p.name, (groups.get(p.name) ?? 0) + 1);
    for (const [name, count] of groups) {
      const row = h('div', 'part-row');
      row.innerHTML = `<div><b>${name}</b><br><small>${count} 件</small></div><span class="badge">${count}</span>`;
      row.addEventListener('click', () => {
        const first = assembly.parts.findIndex((p) => p.name === name);
        store.patch({ selectedId: first });
        viewport.refreshHighlight();
        [...list.children].forEach((c) => c.classList.remove('selected'));
        row.classList.add('selected');
      });
      list.append(row);
    }
    const total = assembly.parts.length;
    stats.replaceChildren(statBar([
      ['科型', keName(store.get().ke)],
      ['踩数', `${store.get().cai}踩`],
      ['构件数', String(total)],
      ['重建耗时', `${ms.toFixed(1)}ms`],
    ]));
  }
  rebuild();
}
