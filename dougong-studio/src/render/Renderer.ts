import { Mat4, Vec3 } from '../core/math';
import { OrbitCamera } from '../core/camera';
import { MergedMesh } from '../dougong/geometry';
import {
  GBUFFER_FS, GBUFFER_VS, HIGHLIGHT_FS, HIGHLIGHT_VS, LIGHT_FS, LINE_FS, LINE_VS,
  QUAD_VS, SHADOW_FS, SHADOW_VS, SSAO_BLUR_FS, SSAO_FS,
} from './shaders';
import { GeneratedTexture, TextureKind, generateTexture } from './textures';
import { MaterialId } from '../dougong/types';

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  ibo: WebGLBuffer;
  indexCount: number;
  groups: { start: number; count: number; material: string }[];
}

interface Program {
  prog: WebGLProgram;
  locs: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const prog = link(gl, vs, fs);
  const locs: Record<string, WebGLUniformLocation | null> = {};
  for (const u of uniforms) locs[u] = gl.getUniformLocation(prog, u);
  return { prog, locs };
}

export interface RenderOptions {
  wireframe: boolean;
  ssao: boolean;
  shadows: boolean;
  /** 需要高亮的实例索引(对应 uploadMesh 的 pick 顺序),-1 表示无 */
  highlightId: number;
}

const MATERIAL_TINT: Record<MaterialId, [number, number, number, number]> = {
  wood: [1, 1, 1, 1],
  xuanzi: [1, 1, 1, 1],
  caizhua: [1, 1, 1, 1],
};

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private cam: OrbitCamera;
  private gbufProg: Program;
  private shadowProg: Program;
  private ssaoProg: Program;
  private blurProg: Program;
  private lightProg: Program;
  private lineProg: Program;
  private highlightProg: Program;
  private quadVao: WebGLVertexArrayObject;
  private gbuffer!: { fbo: WebGLFramebuffer; pos: WebGLTexture; normal: WebGLTexture; albedo: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number };
  private ssaoTex!: WebGLTexture;
  private ssaoBlur!: WebGLTexture;
  private ssaoFboA!: WebGLFramebuffer;
  private ssaoFboB!: WebGLFramebuffer;
  private noiseTex: WebGLTexture;
  private samples: Float32Array;
  private shadowMap!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private shadowSize = 1024;
  private floatGBuffer = true;
  private textures = new Map<TextureKind, { albedo: WebGLTexture; normal: WebGLTexture }>();
  private mesh: GpuMesh | null = null;
  private wireVao: WebGLVertexArrayObject | null = null;
  private wireCount = 0;
  private whiteTex: WebGLTexture;
  lightDir: Vec3 = [-0.42, -0.5, 0.78];
  ambient = 0.55;
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, cam: OrbitCamera) {
    this.canvas = canvas;
    this.cam = cam;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.gbufProg = makeProgram(gl, GBUFFER_VS, GBUFFER_FS,
      ['uViewProj', 'uView', 'uModel', 'uAlbedo', 'uNormalMap', 'uTint', 'uNormalStrength', 'uFloatGBuffer', 'uFar']);
    this.shadowProg = makeProgram(gl, SHADOW_VS, SHADOW_FS, ['uLightVP', 'uModel']);
    this.ssaoProg = makeProgram(gl, QUAD_VS, SSAO_FS,
      ['gPos', 'gNormal', 'uNoise', 'uSamples', 'uProj', 'uProjInv', 'uRadius', 'uFloatGBuffer', 'uFar', 'uScreenSize']);
    this.blurProg = makeProgram(gl, QUAD_VS, SSAO_BLUR_FS, ['uSSAO']);
    this.lightProg = makeProgram(gl, QUAD_VS, LIGHT_FS,
      ['gPos', 'gNormal', 'gAlbedo', 'uSSAO', 'uShadow', 'uLightVP', 'uView', 'uProjInv', 'uLightDir', 'uEye', 'uShadowBias', 'uAmbient', 'uFloatGBuffer', 'uFar']);
    this.lineProg = makeProgram(gl, LINE_VS, LINE_FS, ['uViewProj', 'uModel', 'uColor']);
    this.highlightProg = makeProgram(gl, HIGHLIGHT_VS, HIGHLIGHT_FS,
      ['uViewProj', 'uModel', 'uColor']);

    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // SSAO 核 + 旋转噪声
    this.samples = new Float32Array(32 * 3);
    for (let i = 0; i < 32; i++) {
      const v = new Float32Array([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      const scale = i / 32;
      const k = 0.1 + scale * scale * 0.9;
      this.samples.set([v[0] / l * k, v[1] / l * k, v[2] / l * k], i * 3);
    }
    this.noiseTex = this.makeNoiseTexture();
    this.whiteTex = this.makeWhiteTexture();
    this.initTargets();
    this.ensureTextures();
  }

  private makeWhiteTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  private makeNoiseTexture(): WebGLTexture {
    const gl = this.gl;
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      data[i * 4] = Math.floor(Math.random() * 255);
      data[i * 4 + 1] = Math.floor(Math.random() * 255);
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 255;
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  private canvasTexture(cv: HTMLCanvasElement, srgb: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, cv.width, cv.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  ensureTextures(): void {
    const kinds: TextureKind[] = ['wood', 'xuanzi', 'caizhua'];
    for (const k of kinds) {
      const g: GeneratedTexture = generateTexture(k, 512);
      this.textures.set(k, {
        albedo: this.canvasTexture(g.color, true),
        normal: this.canvasTexture(g.normal, false),
      });
    }
  }

  /** 材质参数变化后重建贴图 */
  refreshTextures(): void {
    const gl = this.gl;
    for (const [k, pair] of this.textures) {
      const g = generateTexture(k, 512);
      gl.bindTexture(gl.TEXTURE_2D, pair.albedo);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, g.color.width, g.color.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, g.color);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, pair.normal);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, g.normal.width, g.normal.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, g.normal);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  private initTargets(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    // GBuffer MRT —— 位置/法线优先 RGBA16F,不支持时回退 RGBA8 归一化编码
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const supportsFloatRT = (() => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
      const tf = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, tf);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.deleteFramebuffer(tf); gl.deleteTexture(t);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      return ok;
    })();
    this.floatGBuffer = supportsFloatRT;

    const mkTex = (internal: number, type: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    // 位置:浮点路径存世界坐标;回退路径存线性深度(视空间 z)+ 屏幕射线编码由着色器处理
    const posInternal = supportsFloatRT ? gl.RGBA16F : gl.RGBA8;
    const posType = supportsFloatRT ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const nrmInternal = supportsFloatRT ? gl.RGBA16F : gl.RGBA8;
    const nrmType = supportsFloatRT ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const pos = mkTex(posInternal, posType);
    const normal = mkTex(nrmInternal, nrmType);
    const albedo = mkTex(gl.RGBA8, gl.UNSIGNED_BYTE);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, albedo, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('GBuffer 帧缓冲不完整,当前设备不支持所需渲染目标格式');
    }
    this.gbuffer = { fbo, pos, normal, albedo, depth, w, h };

    // SSAO 纹理与 FBO —— R16F 不可用时回退 R8 归一化(遮蔽率本身在 0~1)
    const ssaoInternal = supportsFloatRT ? gl.R16F : gl.R8;
    const ssaoType = supportsFloatRT ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const mkAO = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ssaoInternal, w, h, 0, gl.RED, ssaoType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.ssaoTex = mkAO();
    this.ssaoBlur = mkAO();
    this.ssaoFboA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFboA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssaoTex, 0);
    this.ssaoFboB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFboB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssaoBlur, 0);

    // 阴影图
    const sfbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sfbo);
    const st = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, st);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, st, 0);
    gl.drawBuffers([gl.NONE]);
    this.shadowMap = { fbo: sfbo, tex: st };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(64, Math.floor(c.clientWidth * dpr));
    const h = Math.max(64, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
      this.cam.aspect = w / h;
      this.gl.viewport(0, 0, w, h);
      this.disposeTargets();
      this.initTargets();
    }
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const t of [this.gbuffer.pos, this.gbuffer.normal, this.gbuffer.albedo]) gl.deleteTexture(t);
    gl.deleteRenderbuffer(this.gbuffer.depth);
    gl.deleteFramebuffer(this.gbuffer.fbo);
    gl.deleteTexture(this.ssaoTex);
    gl.deleteTexture(this.ssaoBlur);
    gl.deleteFramebuffer(this.ssaoFboA);
    gl.deleteFramebuffer(this.ssaoFboB);
  }

  uploadMesh(mesh: MergedMesh): void {
    const gl = this.gl;
    if (this.mesh) {
      gl.deleteVertexArray(this.mesh.vao);
      gl.deleteBuffer(this.mesh.ibo);
    }
    if (this.wireVao) gl.deleteVertexArray(this.wireVao);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbos: WebGLBuffer[] = [];
    const attrib = (index: number, data: Float32Array, size: number) => {
      const b = gl.createBuffer()!;
      vbos.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
    };
    attrib(0, mesh.positions, 3);
    attrib(1, mesh.normals, 3);
    attrib(2, mesh.uvs, 2);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.mesh = { vao, ibo, indexCount: mesh.indices.length, groups: mesh.groups };

    // 线框 VAO:复用同一套顶点缓冲,换边线索引
    const edges = this.uniqueEdges(mesh.indices);
    const wireVao = gl.createVertexArray()!;
    gl.bindVertexArray(wireVao);
    for (let i = 0; i < vbos.length; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbos[i]);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, i === 2 ? 2 : 3, gl.FLOAT, false, 0, 0);
    }
    const wireIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.wireVao = wireVao;
    this.wireCount = edges.length;
  }

  private uniqueEdges(indices: Uint32Array): Uint32Array {
    const set = new Set<number>();
    const key = (a: number, b: number) => (a < b ? a * 1000003 + b : b * 1000003 + a);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      set.add(key(a, b)); set.add(key(b, c)); set.add(key(c, a));
    }
    const arr = new Uint32Array(set.size * 2);
    let k = 0;
    for (const v of set) {
      arr[k++] = Math.floor(v / 1000003);
      arr[k++] = v % 1000003;
    }
    return arr;
  }

  /** 按场景范围计算正交光 VP(视图空间 z-up 适配) */
  private lightVP(center: Vec3, radius: number): Mat4 {
    const dir: Vec3 = [this.lightDir[0], this.lightDir[1], this.lightDir[2]];
    const eye: Vec3 = [
      center[0] - dir[0] * radius * 2.2,
      center[1] - dir[1] * radius * 2.2,
      center[2] - dir[2] * radius * 2.2 + radius * 0.4,
    ];
    const view = Mat4.lookAt(eye, center);
    // 正交投影:用矩阵直接合成
    const r = radius * 1.4;
    const ortho = new Mat4();
    const o = ortho.m;
    o[0] = 1 / r; o[5] = 1 / r; o[10] = -2 / (r * 4); o[14] = -0.2; o[15] = 1;
    return Mat4.multiply(ortho, view);
  }

  render(opts: RenderOptions, sceneRadius: number, sceneCenter: Vec3,
    highlightMatrix: Mat4 | null, highlightIndexCount: number, highlightVao: WebGLVertexArrayObject | null): void {
    const gl = this.gl;
    this.resize();
    const vp = this.cam.viewProj();
    const view = this.cam.view();
    const projInv = this.cam.proj().invert();
    const lightVP = this.lightVP(sceneCenter, sceneRadius);
    const model = Mat4.identity();

    // 1) 阴影深度
    if (opts.shadows && this.mesh) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowMap.fbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.enable(gl.DEPTH_TEST);
      gl.colorMask(false, false, false, false);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.shadowProg.prog);
      gl.uniformMatrix4fv(this.shadowProg.locs.uLightVP, false, lightVP.m);
      gl.uniformMatrix4fv(this.shadowProg.locs.uModel, false, model.m);
      gl.bindVertexArray(this.mesh.vao);
      gl.drawElements(gl.TRIANGLES, this.mesh.indexCount, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
    }

    // 2) GBuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuffer.fbo);
    gl.viewport(0, 0, this.gbuffer.w, this.gbuffer.h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.05, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.mesh) {
      gl.useProgram(this.gbufProg.prog);
      gl.uniformMatrix4fv(this.gbufProg.locs.uViewProj, false, vp.m);
      gl.uniformMatrix4fv(this.gbufProg.locs.uView, false, view.m);
      gl.uniformMatrix4fv(this.gbufProg.locs.uModel, false, model.m);
      gl.uniform1f(this.gbufProg.locs.uNormalStrength, 0.55);
      gl.uniform1f(this.gbufProg.locs.uFloatGBuffer, this.floatGBuffer ? 1 : 0);
      gl.uniform1f(this.gbufProg.locs.uFar, this.cam.far);
      gl.bindVertexArray(this.mesh.vao);
      for (const grp of this.mesh.groups) {
        const kind = (grp.material as MaterialId) ?? 'wood';
        const tex = this.textures.get(kind === 'caizhua' ? 'caizhua' : kind === 'xuanzi' ? 'xuanzi' : 'wood')!;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.albedo);
        gl.uniform1i(this.gbufProg.locs.uAlbedo, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex.normal);
        gl.uniform1i(this.gbufProg.locs.uNormalMap, 1);
        const tint = MATERIAL_TINT[kind] ?? [1, 1, 1, 1];
        gl.uniform4f(this.gbufProg.locs.uTint, tint[0], tint[1], tint[2], tint[3]);
        gl.drawElements(gl.TRIANGLES, grp.count, gl.UNSIGNED_INT, grp.start * 4);
      }
    }

    // 高亮实例:在 GBuffer 阶段直接覆盖亮色(半透明橙)
    if (highlightMatrix && highlightVao && opts.highlightId >= 0) {
      gl.useProgram(this.highlightProg.prog);
      gl.uniformMatrix4fv(this.highlightProg.locs.uViewProj, false, vp.m);
      gl.uniformMatrix4fv(this.highlightProg.locs.uModel, false, highlightMatrix.m);
      gl.uniform4f(this.highlightProg.locs.uColor, 1.0, 0.55, 0.12, 1.0);
      gl.bindVertexArray(highlightVao);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2, -2);
      gl.drawElements(gl.TRIANGLES, highlightIndexCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // 3) SSAO
    if (opts.ssao) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFboA);
      gl.viewport(0, 0, this.gbuffer.w, this.gbuffer.h);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.ssaoProg.prog);
      gl.bindVertexArray(this.quadVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.pos);
      gl.uniform1i(this.ssaoProg.locs.gPos, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.normal);
      gl.uniform1i(this.ssaoProg.locs.gNormal, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.uniform1i(this.ssaoProg.locs.uNoise, 2);
      gl.uniform3fv(this.ssaoProg.locs.uSamples, this.samples);
      gl.uniformMatrix4fv(this.ssaoProg.locs.uProj, false, this.cam.proj().m);
      gl.uniformMatrix4fv(this.ssaoProg.locs.uProjInv, false, projInv.m);
      gl.uniform1f(this.ssaoProg.locs.uRadius, Math.min(600, this.cam.distance * 0.025));
      gl.uniform1f(this.ssaoProg.locs.uFloatGBuffer, this.floatGBuffer ? 1 : 0);
      gl.uniform1f(this.ssaoProg.locs.uFar, this.cam.far);
      gl.uniform2f(this.ssaoProg.locs.uScreenSize, this.gbuffer.w, this.gbuffer.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 模糊
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFboB);
      gl.useProgram(this.blurProg.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ssaoTex);
      gl.uniform1i(this.blurProg.locs.uSSAO, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4) 光照合成到默认帧缓冲
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.lightProg.prog);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.pos);
    gl.uniform1i(this.lightProg.locs.gPos, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.normal);
    gl.uniform1i(this.lightProg.locs.gNormal, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.albedo);
    gl.uniform1i(this.lightProg.locs.gAlbedo, 2);
    gl.activeTexture(gl.TEXTURE3);
    if (opts.ssao) gl.bindTexture(gl.TEXTURE_2D, this.ssaoBlur);
    else gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
    gl.uniform1i(this.lightProg.locs.uSSAO, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap.tex);
    gl.uniform1i(this.lightProg.locs.uShadow, 4);
    gl.uniformMatrix4fv(this.lightProg.locs.uLightVP, false, lightVP.m);
    gl.uniform3f(this.lightProg.locs.uLightDir, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    const eye = this.cam.eye();
    gl.uniform3f(this.lightProg.locs.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.lightProg.locs.uShadowBias, 0.0006);
    gl.uniform1f(this.lightProg.locs.uAmbient, opts.ssao ? this.ambient : this.ambient + 0.25);
    gl.uniform1f(this.lightProg.locs.uFloatGBuffer, this.floatGBuffer ? 1 : 0);
    gl.uniform1f(this.lightProg.locs.uFar, this.cam.far);
    gl.uniformMatrix4fv(this.lightProg.locs.uView, false, view.m);
    gl.uniformMatrix4fv(this.lightProg.locs.uProjInv, false, projInv.m);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5) 线框(前向叠加,独立边线索引 VAO)
    if (opts.wireframe && this.mesh && this.wireVao) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(this.lineProg.prog);
      gl.uniformMatrix4fv(this.lineProg.locs.uViewProj, false, vp.m);
      gl.uniformMatrix4fv(this.lineProg.locs.uModel, false, model.m);
      gl.uniform4f(this.lineProg.locs.uColor, 0.05, 0.06, 0.07, 0.9);
      gl.bindVertexArray(this.wireVao);
      gl.drawElements(gl.LINES, this.wireCount, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
    }
  }
}
