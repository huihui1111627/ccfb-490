import { Viewport } from '../../render/viewport';
import { store } from '../../state/store';
import { generateTexture, TextureKind, TextureOptions, DEFAULT_TEXTURE_OPTS } from '../../render/textures';
import { h, pageLayout } from '../dom';
import { Mat4 } from '../../core/math';
import { mergePieces } from '../../dougong/geometry';
import { buildStraightBar } from '../../dougong/builders';
import { MaterialId } from '../../dougong/types';

export function renderMaterialPage(root: HTMLElement, viewport: Viewport, canvas: HTMLCanvasElement): void {
  root.innerHTML = '';
  const panel = h('div', 'panel');
  panel.append(h('h3', '', '程序化材质(无外部图片)'));

  const opts: TextureOptions = { ...DEFAULT_TEXTURE_OPTS };
  const swatches: Record<TextureKind, HTMLImageElement> = {} as never;
  const kinds: [TextureKind, string][] = [
    ['wood', '木纹(纤维/年轮/木节)'],
    ['xuanzi', '旋子彩画(找头旋花/枋心)'],
    ['caizhua', '彩画变体(金线调换)'],
  ];
  for (const [kind, label] of kinds) {
    const sec = h('section');
    sec.append(h('div', '', `<b style="font-size:13px">${label}</b>`));
    const img = document.createElement('img');
    img.className = 'swatch';
    swatches[kind] = img;
    sec.append(img);
    panel.append(sec);
  }

  // 颜色调整
  panel.append(h('h3', '', '基色调整'));
  const colorRow = (label: string, key: keyof TextureOptions, initial: [number, number, number]) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = '#' + initial.map((v) => v.toString(16).padStart(2, '0')).join('');
    inp.addEventListener('input', () => {
      const hex = inp.value;
      opts[key] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      regenerate();
    });
    const wrap = h('label', 'field');
    wrap.append(h('span', 'field-label', label), inp);
    panel.append(wrap);
  };
  colorRow('木材基色', 'woodBase', DEFAULT_TEXTURE_OPTS.woodBase);
  colorRow('木纹深色', 'woodDark', DEFAULT_TEXTURE_OPTS.woodDark);
  colorRow('彩画青绿', 'caiBase', DEFAULT_TEXTURE_OPTS.caiBase);
  colorRow('彩画贴金', 'caiAccent', DEFAULT_TEXTURE_OPTS.caiAccent);

  // 材质应用到斗拱
  panel.append(h('h3', '', '材质应用'));
  const apply = (m: MaterialId | 'mixed') => {
    store.patch({ materialOverride: m });
    applyMaterialToPreview(m);
  };
  const btns = h('div', 'row-actions');
  for (const [v, label] of [['wood', '素木'], ['xuanzi', '旋子彩画'], ['mixed', '按构件混合']] as [MaterialId | 'mixed', string][]) {
    const b = h('button', v === 'mixed' ? 'primary' : '', label);
    b.addEventListener('click', () => apply(v));
    btns.append(b);
  }
  panel.append(btns);

  const regenerate = () => {
    for (const [kind] of kinds) {
      const tex = generateTexture(kind, 512, opts);
      swatches[kind].src = tex.color.toDataURL();
    }
    viewport.refreshTextures();
    applyMaterialToPreview(store.get().materialOverride);
  };

  const applyMaterialToPreview = (m: MaterialId | 'mixed') => {
    const d = store.get().doukou;
    const g = buildStraightBar(d, { kind: 'wangong', zhengxin: true });
    const mat: MaterialId = m === 'mixed' ? 'xuanzi' : m;
    const mesh = mergePieces([{ geo: g.geo, matrix: Mat4.identity(), material: mat }]);
    viewport.renderer.uploadMesh(mesh);
    viewport.loadHall(mesh, [], g.size[0] * 0.7, [0, 0, g.size[2] / 2]);
  };

  const layout = pageLayout(canvas, panel);
  root.append(layout);
  queueMicrotask(regenerate);
}
