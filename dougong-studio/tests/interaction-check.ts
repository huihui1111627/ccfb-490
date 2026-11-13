// 拾取高亮 + 程序化贴图 + 材质切换验证
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9342;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-first-run', `--user-data-dir=${resolve('./node_modules/.cache/chrome-p10')}`,
    'http://localhost:5173/',
  ], { stdio: 'ignore' });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 30; i++) { await sleep(500);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      target = l.find((t) => t.type === 'page'); if (target) break; } catch { /* */ } }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let mid = 0; const pending = new Map<number, (v: unknown) => void>();
  const logs: string[] = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data as string);
    if (m.id) pending.get(m.id)?.(m.result), pending.delete(m.id);
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); });
  const send = (method: string, params: object = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await sleep(3000);
  const evalJs = async (e: string) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }) as { result?: { value?: unknown }, exceptionDetails?: { text: string; description?: string } };
    if (r.exceptionDetails) logs.push('EVAL ' + (r.exceptionDetails.description ?? r.exceptionDetails.text));
    return r.result?.value;
  };

  const out = {};
  // 1) 程序化贴图:在页面内生成,检查非空白且有色彩变化
  out.textures = await evalJs(`(async () => {
    const t = await import('/src/render/textures.ts');
    const res = {};
    for (const kind of ['wood', 'xuanzi', 'caizhua']) {
      const g = t.generateTexture(kind, 256);
      const ctx = g.color.getContext('2d');
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const colors = new Set();
      for (let i = 0; i < d.length; i += 4 * 37) colors.add((d[i] >> 4) * 256 + (d[i+1] >> 4) * 16 + (d[i+2] >> 4));
      res[kind] = { distinctColors: colors.size, hasNormal: g.normal.width === 256 };
    }
    return res;
  })()`);

  // 2) 拾取:构造一条穿过坐斗的射线(组合页第一个构件在原点附近)
  out.pick = await evalJs(`(() => {
    const { viewport } = window.dougongStudio;
    const picker = viewport['parts'];
    if (!picker || !picker.length) return { error: '无拾取体' };
    // 用相机朝目标点的射线
    const cam = viewport['cam'];
    const ray = cam.pickRay(0, 0); // 屏幕中心
    const { pick } = { pick: null };
    return { partCount: picker.length, rayOrigin: ray.origin.map(v=>+v.toFixed(1)), hasOBB: !!picker[0].obb };
  })()`);

  // 真正调 pick 函数
  out.pickHit = await evalJs(`(async () => {
    const pickMod = await import('/src/render/picker.ts');
    const { viewport } = window.dougongStudio;
    const cam = viewport['cam'];
    // 多方向射线提高命中率
    const hits = [];
    for (const x of [-0.3, 0, 0.3]) for (const y of [-0.3, 0, 0.3]) {
      const ray = cam.pickRay(x, y);
      const h = pickMod.pick(ray, viewport['parts']);
      if (h) hits.push(h.id);
    }
    const uniq = [...new Set(hits)];
    return { raysHit: hits.length, uniqueParts: uniq.length, sampleIds: uniq.slice(0, 5) };
  })()`);

  // 3) 选中后高亮网格生成
  out.highlight = await evalJs(`(async () => {
    const { store } = window.dougongStudio;
    store.patch({ selectedId: 0 });
    window.dougongStudio.viewport.refreshHighlight();
    await new Promise(r => requestAnimationFrame(r));
    const vp = window.dougongStudio.viewport;
    return { highlightBuilt: vp['highlight'] !== null && vp['highlight'] !== undefined };
  })()`);

  // 4) 材质页切换不报错
  await evalJs(`document.querySelector('#tabs button[data-tab="material"]').click()`);
  await sleep(1200);
  out.materialPageSwatches = await evalJs(`document.querySelectorAll('.swatch').length`);
  out.materialPageImagesLoaded = await evalJs(`[...document.querySelectorAll('.swatch')].filter(i => i.complete && i.naturalWidth > 0).length`);

  console.log(JSON.stringify(out, null, 1));
  console.log(logs.length ? '\n异常:\n' + logs.join('\n') : '\n无异常');
  ws.close(); chrome.kill(); process.exit(0);
}
main();
