/**
 * Headless Chrome CDP 冒烟:加载 vite dev 页面,采集 console 错误,
 * 逐一切换五个页签并触发全局参数重建。
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL = process.argv[2] ?? 'http://localhost:5173/';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function cdp(): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  const sock = createConnection({ port: PORT, host: '127.0.0.1' });
  await new Promise((r) => sock.once('connect', r));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const events: { method: string; params: unknown }[] = [];
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id) pending.get(msg.id)?.(msg.result), pending.delete(msg.id);
      else events.push(msg);
    }
  });
  const send = (method: string, params: object = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    sock.write(JSON.stringify({ id: mid, method, params }) + '\n');
  });
  return {
    send,
    close: () => sock.end(),
    getEvents: () => events.splice(0, events.length),
  } as never;
}

async function main() {
  const userDir = resolve('./node_modules/.cache/chrome-profile');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stderr.on('data', () => {});
  // 轮询等待 page target
  let target: { webSocketDebuggerUrl: string; type: string; url: string } | undefined;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as { webSocketDebuggerUrl: string; type: string; url: string }[];
      target = list.find((t) => t.type === 'page' && t.url.startsWith('http'))
        ?? list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 还没起好 */ }
  }
  if (!target) { console.error('Chrome CDP 未就绪'); chrome.kill(); process.exit(2); }

  // 用简易 ws:直接走 CDP 的 HTTP 不支持,改用 node 的 WebSocket(Node 22 内置)
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let mid = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const errors: string[] = [];
  const warnings: string[] = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result), pending.delete(msg.id);
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      const text = msg.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description ?? '').join(' ');
      (msg.params.type === 'error' ? errors : warnings).push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
  });
  const send = (method: string, params: object = {}) => new Promise((resolve) => {
    const id = ++mid; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const evalJs = async (expr: string) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }) as { result?: { value?: unknown }, exceptionDetails?: unknown };
    if (r.exceptionDetails) errors.push('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };

  // 基本状态
  const glInfo = await evalJs(`(() => {
    const c = document.querySelector('.stage canvas');
    if (!c) return 'no canvas';
    const gl = c.getContext('webgl2');
    return gl ? gl.getParameter(gl.VERSION) : 'webgl2 unavailable';
  })()`);
  console.log('WebGL2:', glInfo);

  // 逐页切换
  const tabs = ['library', 'assembly', 'hall', 'material', 'export'];
  for (const tab of tabs) {
    await evalJs(`document.querySelector('#tabs button[data-tab="${tab}"]').click()`);
    await sleep(900);
    const ok = await evalJs(`document.querySelector('#page-root').children.length > 0`);
    console.log(`页签 ${tab}:`, ok ? '渲染 ✓' : '空白 ✗');
  }

  // 全局斗口联动
  await evalJs(`document.querySelector('#tabs button[data-tab="assembly"]').click()`);
  await sleep(400);
  const before = await evalJs(`window.dougongStudio.store.get().doukou`);
  await evalJs(`(() => {
    const i = document.getElementById('global-doukou');
    i.value = '120';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(600);
  const after = await evalJs(`window.dougongStudio.store.get().doukou`);
  console.log(`斗口联动: ${before} -> ${after}`, Number(after) === 120 ? '✓' : '✗');

  // 踩数/科型
  await evalJs(`(() => {
    const s = document.getElementById('global-cai'); s.value='5';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(400);
  await evalJs(`(() => {
    const s = document.getElementById('global-ke'); s.value='jiao';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(400);
  const st = await evalJs(`JSON.stringify(window.dougongStudio.store.get())`) as string;
  console.log('参数切换后状态片段:', st.slice(0, 160) + '...');

  // 爆炸视图
  await evalJs(`(() => {
    const r = document.querySelector('input[type=range]');
    r.value = '0.7'; r.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(500);
  const exp = await evalJs(`window.dougongStudio.store.get().explode`);
  console.log('爆炸视图:', Number(exp) === 0.7 ? '✓' : '✗');

  // 整殿页性能
  await evalJs(`document.querySelector('#tabs button[data-tab="hall"]').click()`);
  await sleep(1200);
  const hallStat = await evalJs(`[...document.querySelectorAll('.stat b')].map(e=>e.textContent).join(' | ')`);
  console.log('整殿统计:', hallStat);

  console.log('\n--- console 错误:', errors.length, '条 ---');
  errors.slice(0, 12).forEach((e) => console.log(' ✗', e.slice(0, 300)));
  if (warnings.length) { console.log('--- 警告:', warnings.length, '条 ---'); warnings.slice(0, 6).forEach((w) => console.log(' !', w.slice(0, 200))); }

  // 截图存档
  const shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('./node_modules/.cache/page.png', Buffer.from(shot.data, 'base64'));
  console.log('\n截图已存 node_modules/.cache/page.png');

  ws.close();
  chrome.kill();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
