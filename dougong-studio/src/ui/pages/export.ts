import { Viewport } from '../../render/viewport';
import { store } from '../../state/store';
import { h, pageLayout } from '../dom';
import { exportCSV, exportOBJ } from '../../services/exporters';
import { deleteScheme, diffSchemes, loadSchemes, newSchemeId, saveScheme } from '../../services/storage';
import { SavedScheme } from '../../dougong/types';
import { bakeAssembly } from '../../dougong/mesh';
import { assemble } from '../../dougong/assembly';
import { buildHall, mergeHall } from '../../dougong/hall';

export function renderExportPage(root: HTMLElement, viewport: Viewport, canvas: HTMLCanvasElement): void {
  root.innerHTML = '';
  const panel = h('div', 'panel');

  // —— 导出 ——
  panel.append(h('h3', '', '模型与清单导出'));
  const row1 = h('div', 'row-actions');
  const btnCsv = h('button', 'primary', '导出构件清单 CSV');
  btnCsv.addEventListener('click', () => exportCSV(assemble(store.assemblyParams())));
  const btnObj = h('button', 'primary', '导出当前斗拱 OBJ');
  btnObj.addEventListener('click', () => {
    const a = assemble(store.assemblyParams());
    const baked = bakeAssembly(a, 0);
    exportOBJ(baked.mesh, `dougong_${a.params.cai}cai_${a.params.doukou}mm`);
  });
  const btnHallObj = h('button', '', '导出整殿 OBJ');
  btnHallObj.addEventListener('click', () => {
    const scene = buildHall(store.hallParams());
    const { mesh } = mergeHall(scene);
    exportOBJ(mesh, `hall_${store.get().doukou}mm`);
  });
  row1.append(btnCsv, btnObj, btnHallObj);
  panel.append(row1);

  // —— 方案保存 ——
  panel.append(h('h3', '', '方案版本(localStorage)'));
  const nameInput = document.createElement('input');
  nameInput.placeholder = '方案名称,如:正殿九踩方案';
  nameInput.style.width = '100%';
  nameInput.style.marginBottom = '8px';
  const noteInput = document.createElement('input');
  noteInput.placeholder = '备注(可选)';
  noteInput.style.width = '100%';
  noteInput.style.marginBottom = '8px';
  const btnSave = h('button', 'primary', '保存当前参数为新版本');
  btnSave.style.width = '100%';
  btnSave.addEventListener('click', () => {
    const st = store.get();
    const scheme: SavedScheme = {
      id: newSchemeId(),
      name: nameInput.value || `方案 ${new Date().toLocaleString('zh-CN')}`,
      createdAt: Date.now(),
      note: noteInput.value,
      assembly: store.assemblyParams(),
      hall: { ...st.hall },
    };
    saveScheme(scheme);
    nameInput.value = ''; noteInput.value = '';
    renderList();
  });
  panel.append(nameInput, noteInput, btnSave);

  // —— 版本列表与对比 ——
  panel.append(h('h3', '', '已存版本'));
  const listWrap = h('div');
  const diffWrap = h('section');
  panel.append(listWrap, diffWrap);

  const renderList = () => {
    listWrap.innerHTML = '';
    const schemes = loadSchemes();
    if (!schemes.length) {
      listWrap.append(h('p', '', '<small style="color:var(--muted)">暂无保存方案</small>'));
      return;
    }
    const checkboxes: HTMLInputElement[] = [];
    for (const sc of schemes) {
      const card = h('div', 'scheme-card');
      card.innerHTML = `
        <header><b>${sc.name}</b><span class="badge">${new Date(sc.createdAt).toLocaleString('zh-CN')}</span></header>
        <div class="meta">斗口 ${sc.assembly.doukou}mm · ${sc.assembly.cai}踩 · ${sc.assembly.ke}
        · ${sc.hall.bays}开间×${sc.hall.depths}进深${sc.note ? '<br>备注:' + sc.note : ''}</div>`;
      const actions = h('div', 'row-actions');
      actions.style.marginTop = '8px';
      const ck = document.createElement('input');
      ck.type = 'checkbox'; ck.value = sc.id;
      checkboxes.push(ck);
      const ckLabel = h('label', 'check');
      ckLabel.append(ck, h('span', '', '加入对比'));
      const load = h('button', '', '载入此版');
      load.addEventListener('click', () => {
        store.patch({
          doukou: sc.assembly.doukou, cai: sc.assembly.cai, ke: sc.assembly.ke,
          hall: { ...sc.hall }, selectedId: -1,
        });
        viewport.loadAssembly();
      });
      const del = h('button', '', '删除');
      del.addEventListener('click', () => { deleteScheme(sc.id); renderList(); });
      actions.append(ckLabel, load, del);
      card.append(actions);
      listWrap.append(card);
    }
    const diffBtn = h('button', 'primary', '对比勾选的两个版本');
    diffBtn.style.marginTop = '10px';
    diffBtn.addEventListener('click', () => {
      const ids = checkboxes.filter((c) => c.checked).map((c) => c.value);
      if (ids.length !== 2) {
        diffWrap.innerHTML = '<p style="color:var(--danger);font-size:12px">请恰好勾选两个版本</p>';
        return;
      }
      const all = loadSchemes();
      const a = all.find((x) => x.id === ids[0])!;
      const b = all.find((x) => x.id === ids[1])!;
      const table = h('table');
      table.innerHTML = `<thead><tr><th>参数</th><th>${a.name}</th><th>${b.name}</th></tr></thead><tbody></tbody>`;
      const tb = table.querySelector('tbody')!;
      for (const d of diffSchemes(a, b)) {
        const tr = h('tr', d.changed ? 'changed' : '');
        tr.innerHTML = `<td>${d.field}</td><td>${d.a}</td><td>${d.b}</td>`;
        tb.append(tr);
      }
      diffWrap.innerHTML = '';
      diffWrap.append(h('h3', '', '版本差异(红色行=已变更)'), table);
    });
    listWrap.append(diffBtn);
  };
  renderList();

  const layout = pageLayout(canvas, panel);
  root.append(layout);
  queueMicrotask(() => viewport.loadAssembly());
}
