import { Viewport } from '../../render/viewport';
import { store } from '../../state/store';
import { buildHall, mergeHall } from '../../dougong/hall';
import { field, h, numberInput, pageLayout, statBar } from '../dom';

export function renderHallPage(root: HTMLElement, viewport: Viewport, canvas: HTMLCanvasElement): void {
  root.innerHTML = '';
  const s = store.get();
  const panel = h('div', 'panel');
  panel.append(h('h3', '', '整殿参数(随斗口联动)'));

  const bays = numberInput(s.hall.bays, 1, 7, 1);
  const depths = numberInput(s.hall.depths, 1, 5, 1);
  const bayW = numberInput(s.hall.bayWidth, 1000, 30000, 10);
  const depthW = numberInput(s.hall.depthWidth, 1000, 20000, 10);
  const colH = numberInput(s.hall.columnHeight, 1000, 20000, 10);
  panel.append(
    field('面阔开间数', bays),
    field('进深间数', depths),
    field('明间面阔 mm', bayW),
    field('每进进深 mm', depthW),
    field('檐柱高 mm', colH),
  );

  const sync = () => {
    store.patchHall({
      bays: Number(bays.value), depths: Number(depths.value),
      bayWidth: Number(bayW.value), depthWidth: Number(depthW.value),
      columnHeight: Number(colH.value),
    });
    rebuild();
  };
  [bays, depths, bayW, depthW, colH].forEach((i) => i.addEventListener('change', sync));

  panel.append(h('h3', '', '斗拱布列规则'));
  panel.append(h('section', '', `<p style="font-size:12px;color:var(--muted);line-height:1.9">
    四角自动布角科;柱顶布柱头科;柱间按约 11 斗口档距均布平身科。<br>
    平板枋、檐檩与柱网尺寸全部由斗口 d 导出,修改顶部斗口即全殿线性重建。</p>`));

  const stats = h('div');
  const layout = pageLayout(canvas, panel);
  layout.querySelector('.stage')!.append(stats);
  root.append(layout);

  function rebuild(): void {
    const t0 = performance.now();
    const scene = buildHall(store.hallParams());
    const { mesh, pieces } = mergeHall(scene);
    viewport.setHallPieces(pieces);
    const fp = scene.footprint;
    // 取景半径以平面外接圆为准,目标点抬到斗拱层附近便于观察
    const radius = Math.hypot(fp.x, fp.y) * 0.52;
    const bracketZ = store.get().hall.columnHeight + 2 * store.get().doukou + radius * 0.12;
    viewport.loadHall(mesh, pieces, radius, [0, 0, bracketZ]);
    const ms = performance.now() - t0;
    const bracketCount = pieces.filter((p) => p.kind !== 'column' && p.kind !== 'purlin' && p.kind !== 'beam').length;
    stats.replaceChildren(statBar([
      ['面阔', `${(fp.x / 1000).toFixed(2)}m`],
      ['进深', `${(fp.y / 1000).toFixed(2)}m`],
      ['斗拱构件', String(bracketCount)],
      ['整殿重建', `${ms.toFixed(1)}ms`],
      ['1 秒目标', ms < 1000 ? '<span class="ok">达标</span>' : '<span class="warn">超阈值</span>'],
    ]));
  }
  rebuild();
}
