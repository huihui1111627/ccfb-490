import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-first-run', `--user-data-dir=${resolve('./node_modules/.cache/chrome-p6')}`,
    '--window-size=1400,900',
    'http://localhost:5173/',
  ], { stdio: 'ignore' });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 30; i++) { await sleep(500);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      target = l.find((t) => t.type === 'page'); if (target) break; } catch { /* */ } }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let mid = 0; const pending = new Map<number, (v: unknown) => void>();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data as string);
    if (m.id) pending.get(m.id)?.(m.result), pending.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await sleep(3000);
  const evalJs = async (e: string) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true } as object)).catch?.(() => null);
  // 组合页默认已打开;切到九踩平身科
  await evalJs(`(() => { const s=document.getElementById('global-cai'); s.value='9'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(1500);
  let shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('./node_modules/.cache/shot-assembly.png', Buffer.from(shot.data, 'base64'));
  // 爆炸
  await evalJs(`(() => { const r=document.querySelector('input[type=range]'); r.value='0.6'; r.dispatchEvent(new Event('input')); })()`);
  await sleep(1200);
  shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('./node_modules/.cache/shot-explode.png', Buffer.from(shot.data, 'base64'));
  // 线框
  await evalJs(`(() => { const r=document.querySelector('input[type=range]'); r.value='0'; r.dispatchEvent(new Event('input')); })()`);
  await sleep(800);
  await evalJs(`[...document.querySelectorAll('.check input')][0].click()`);
  await sleep(1000);
  shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('./node_modules/.cache/shot-wire.png', Buffer.from(shot.data, 'base64'));
  // 整殿
  await evalJs(`document.querySelector('#tabs button[data-tab="hall"]').click()`);
  await sleep(1800);
  shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('./node_modules/.cache/shot-hall.png', Buffer.from(shot.data, 'base64'));
  console.log('4 张截图已保存');
  ws.close(); chrome.kill(); process.exit(0);
}
main();
