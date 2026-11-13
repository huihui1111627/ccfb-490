import './ui/styles.css';
import { store } from './state/store';
import { Viewport } from './render/viewport';
import { renderLibraryPage } from './ui/pages/library';
import { renderAssemblyPage } from './ui/pages/assembly';
import { renderHallPage } from './ui/pages/hall';
import { renderMaterialPage } from './ui/pages/material';
import { renderExportPage } from './ui/pages/export';
import { Cai, KeType } from './dougong/types';

const pageRoot = document.getElementById('page-root')!;
const tooltip = document.getElementById('tooltip')!;
const canvas = document.createElement('canvas');
const viewport = new Viewport(canvas, tooltip);

let currentTab = 'assembly';
const renderers: Record<string, () => void> = {
  library: () => renderLibraryPage(pageRoot, viewport, canvas),
  assembly: () => renderAssemblyPage(pageRoot, viewport, canvas),
  hall: () => renderHallPage(pageRoot, viewport, canvas),
  material: () => renderMaterialPage(pageRoot, viewport, canvas),
  export: () => renderExportPage(pageRoot, viewport, canvas),
};

function switchTab(tab: string): void {
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
  renderers[tab]();
}

document.querySelectorAll('#tabs button').forEach((b) => {
  b.addEventListener('click', () => switchTab((b as HTMLElement).dataset.tab!));
});

// —— 全局参数:斗口/踩数/科型,改动后按当前页防抖重建 ——
const doukouInput = document.getElementById('global-doukou') as HTMLInputElement;
const caiSel = document.getElementById('global-cai') as HTMLSelectElement;
const keSel = document.getElementById('global-ke') as HTMLSelectElement;

let rebuildTimer = 0;
const scheduleRebuild = () => {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    if (currentTab === 'hall') renderers.hall();
    else if (currentTab === 'assembly' || currentTab === 'export') viewport.loadAssembly();
    else if (currentTab === 'library') renderers.library();
    else if (currentTab === 'material') renderers.material();
  }, 120);
};

doukouInput.addEventListener('input', () => {
  const v = Math.max(40, Math.min(200, Number(doukouInput.value) || 90));
  store.patch({ doukou: v, selectedId: -1 });
  scheduleRebuild();
});
caiSel.addEventListener('change', () => {
  store.patch({ cai: Number(caiSel.value) as Cai, selectedId: -1 });
  scheduleRebuild();
});
keSel.addEventListener('change', () => {
  store.patch({ ke: keSel.value as KeType, selectedId: -1 });
  scheduleRebuild();
});

// 初始进入组合页
switchTab('assembly');

// 暴露给控制台做尺寸核验
declare global {
  interface Window {
    dougongStudio: { store: typeof store; viewport: Viewport };
  }
}
window.dougongStudio = { store, viewport };
