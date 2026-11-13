// 程序化材质贴图:木纹 + 旋子彩画,全部 Canvas 2D 现场绘制,不依赖外部图片
export type TextureKind = 'wood' | 'xuanzi' | 'caizhua';

export interface GeneratedTexture {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  kind: TextureKind;
}

export interface TextureOptions {
  woodBase: [number, number, number];
  woodDark: [number, number, number];
  caiBase: [number, number, number];
  caiAccent: [number, number, number];
  caiLine: [number, number, number];
}

export const DEFAULT_TEXTURE_OPTS: TextureOptions = {
  woodBase: [178, 128, 78],
  woodDark: [108, 70, 38],
  caiBase: [58, 92, 128],
  caiAccent: [178, 142, 64],
  caiLine: [40, 44, 52],
};

// 可复现的一维值噪声
function makeNoise(seed: number): (x: number) => number {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number) => {
    const xi = Math.floor(x) & 255;
    const xf = x - Math.floor(x);
    const u = fade(xf);
    const a = perm[xi] / 255, b = perm[xi + 1] / 255;
    return a + (b - a) * u;
  };
}

function rgb(c: [number, number, number], a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function woodCanvas(size: number, o: TextureOptions): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const n1 = makeNoise(7), n2 = makeNoise(31);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 纵向纤维:多条不同频率正弦叠加 + 噪声漂移
      const drift = n1(x * 0.02) * 26 + n2(x * 0.08) * 8;
      const grain = 0.5 + 0.5 * Math.sin((y + drift) * 0.11)
        + 0.25 * Math.sin((y + drift) * 0.47 + n2(x * 0.05) * 6);
      const ring = 0.5 + 0.5 * Math.sin((y + drift) * 0.028 + n1(x * 0.015) * 4);
      const t = Math.min(1, Math.max(0, 0.25 + grain * 0.32 + ring * 0.28 + (n2((x + y) * 0.05) - 0.5) * 0.12));
      const i = (y * size + x) * 4;
      img.data[i] = o.woodDark[0] + (o.woodBase[0] - o.woodDark[0]) * t;
      img.data[i + 1] = o.woodDark[1] + (o.woodBase[1] - o.woodDark[1]) * t;
      img.data[i + 2] = o.woodDark[2] + (o.woodBase[2] - o.woodDark[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 木节
  const n3 = makeNoise(99);
  for (let k = 0; k < 4; k++) {
    const kx = n3(k * 3.1) * size, ky = n3(k * 5.7 + 1) * size;
    const r = 10 + n3(k * 2.3 + 4) * 22;
    const grad = ctx.createRadialGradient(kx, ky, 2, kx, ky, r);
    grad.addColorStop(0, rgb(o.woodDark, 0.85));
    grad.addColorStop(0.55, rgb(o.woodDark, 0.35));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(kx, ky, r * 0.7, r, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

/** 旋子彩画:箍头 + 找头(旋花瓣)+ 枋心,水平三铺作可重复 */
function xuanziCanvas(size: number, o: TextureOptions): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  // 底色:青绿退晕
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, rgb(lift(o.caiBase, 26)));
  bg.addColorStop(0.5, rgb(o.caiBase));
  bg.addColorStop(1, rgb(lift(o.caiBase, -26)));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const band = size / 8;
  // 上下箍头线(贴金边线)
  ctx.fillStyle = rgb(o.caiAccent);
  ctx.fillRect(0, band * 0.35, size, band * 0.18);
  ctx.fillRect(0, size - band * 0.53, size, band * 0.18);
  ctx.fillStyle = rgb(o.caiLine);
  ctx.fillRect(0, band * 0.6, size, 2);
  ctx.fillRect(0, size - band * 0.62, size, 2);

  // 找头:一整两破旋花(三组)
  for (let g = 0; g < 3; g++) {
    const cx = size * (0.2 + g * 0.3);
    const cy = size / 2;
    const R = size * 0.16;
    drawSpiralFlower(ctx, cx, cy, R, o);
  }
  // 枋心:中段菱纹如意
  const fx0 = size * 0.42, fx1 = size * 0.58;
  ctx.fillStyle = rgb(lift(o.caiBase, 40), 0.9);
  ctx.fillRect(fx0, size * 0.28, fx1 - fx0, size * 0.44);
  ctx.strokeStyle = rgb(o.caiAccent);
  ctx.lineWidth = 3;
  ctx.strokeRect(fx0, size * 0.28, fx1 - fx0, size * 0.44);
  ctx.beginPath();
  ctx.moveTo(fx0, size / 2);
  ctx.bezierCurveTo(size * 0.46, size * 0.34, size * 0.54, size * 0.66, fx1, size / 2);
  ctx.stroke();
  return cv;
}

function drawSpiralFlower(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, o: TextureOptions): void {
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(a) * R * 0.62;
    const py = cy + Math.sin(a) * R * 0.62;
    ctx.beginPath();
    ctx.ellipse(px, py, R * 0.42, R * 0.22, a, 0, Math.PI * 2);
    ctx.fillStyle = rgb(lift(o.caiBase, i % 2 ? 18 : -10), 0.92);
    ctx.fill();
    ctx.strokeStyle = rgb(o.caiLine, 0.8);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = rgb(o.caiAccent);
  ctx.fill();
  ctx.strokeStyle = rgb(o.caiLine);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = rgb(o.caiLine);
  ctx.fill();
}

function lift(c: [number, number, number], d: number): [number, number, number] {
  return [Math.min(255, c[0] + d), Math.min(255, c[1] + d), Math.min(255, c[2] + d)];
}

/** 由颜色图亮度梯度生成切线空间法线贴图 */
function normalFromLuminance(color: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const size = color.width;
  const src = color.getContext('2d')!.getImageData(0, 0, size, size).data;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const out = ctx.createImageData(size, size);
  const lum = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    return src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = lum((x - 1 + size) % size, y), xr = lum((x + 1) % size, y);
      const yt = lum(x, (y - 1 + size) % size), yb = lum(x, (y + 1) % size);
      let nx = (xl - xr) / 255 * strength;
      let ny = (yt - yb) / 255 * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

const cache = new Map<string, GeneratedTexture>();

export function generateTexture(kind: TextureKind, size = 512, opts: TextureOptions = DEFAULT_TEXTURE_OPTS): GeneratedTexture {
  const key = `${kind}-${size}-${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = kind === 'wood' ? woodCanvas(size, opts)
    : kind === 'xuanzi' ? xuanziCanvas(size, opts)
      : xuanziCanvas(size, { ...opts, caiBase: opts.caiAccent, caiAccent: opts.caiBase });
  const normal = normalFromLuminance(color);
  const tex: GeneratedTexture = { color, normal, kind };
  cache.set(key, tex);
  return tex;
}
