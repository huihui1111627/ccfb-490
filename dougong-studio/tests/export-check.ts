// 导出与存储功能验证:拦截下载、校验 OBJ/CSV 内容,往返测试 localStorage 方案
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-first-run', `--user-data-dir=${resolve('./node_modules/.cache/chrome-p9')}`,
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

  // 在页面内直接调用导出模块(拦截 Blob 下载,读取内容)
  const result = await evalJs(`(async () => {
    const mod = await import('/src/services/exporters.ts');
    const asmMod = await import('/src/dougong/assembly.ts');
    const meshMod = await import('/src/dougong/mesh.ts');
    const storeMod = await import('/src/state/store.ts');
    const out = {};

    // 拦截下载
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:fake'; };
    HTMLAnchorElement.prototype.click = function(){};

    // OBJ
    const a = asmMod.assemble(storeMod.store.assemblyParams());
    const baked = meshMod.bakeAssembly(a, 0);
    mod.exportOBJ(baked.mesh, 'test');
    const objText = await captured.text();
    out.objBytes = objText.length;
    out.objHasV = objText.includes('v ');
    out.objHasF = objText.includes('f ');
    out.objVertCount = (objText.match(/^v /gm) || []).length;
    out.objFaceCount = (objText.match(/^f /gm) || []).length;
    out.objMtlGroup = objText.includes('usemtl wood');

    // CSV
    captured = null;
    mod.exportCSV(a);
    const csvText = await captured.text();
    out.csvBytes = csvText.length;
    out.csvHeader = csvText.split('\\n')[0];
    out.csvRows = csvText.split('\\n').filter(l => l.trim()).length;
    out.csvHasDoukou = csvText.includes('斗口');

    URL.createObjectURL = origCreate;

    // 方案存储往返
    const storage = await import('/src/services/storage.ts');
    localStorage.clear();
    const scheme = {
      id: storage.newSchemeId(), name: '测试方案', createdAt: Date.now(), note: '冒烟',
      assembly: storeMod.store.assemblyParams(),
      hall: { ...storeMod.store.get().hall },
    };
    storage.saveScheme(scheme);
    const loaded = storage.loadSchemes();
    out.storageRoundtrip = loaded.length === 1 && loaded[0].name === '测试方案';
    // diff
    const scheme2 = { ...scheme, id: storage.newSchemeId(), assembly: { ...scheme.assembly, doukou: 120 } };
    storage.saveScheme(scheme2);
    const diff = storage.diffSchemes(loaded[0], storage.loadSchemes()[0]);
    out.diffDetectsDoukou = diff.some(d => d.field.includes('斗口') && d.changed);
    return out;
  })()`);
  console.log('导出/存储验证:');
  console.log(JSON.stringify(result, null, 1));
  console.log(logs.length ? '\n异常:\n' + logs.join('\n') : '\n无异常');
  ws.close(); chrome.kill();
  process.exit(0);
}
main();
