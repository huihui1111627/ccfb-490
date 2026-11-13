import { Mat4, Vec3 } from '../core/math';
import { OrbitCamera } from '../core/camera';
import { Renderer } from './Renderer';
import { MergedMesh, RawGeometry, createRaw, mergePieces } from '../dougong/geometry';
import { BakedPart, bakeAssembly, explodeMatrix } from '../dougong/mesh';
import { assemble, assemblyGeometries } from '../dougong/assembly';
import { pick } from './picker';
import { store } from '../state/store';
import { HallPiece } from '../dougong/hall';

export type ViewMode = 'assembly' | 'hall';

interface HighlightGpu {
  vao: WebGLVertexArrayObject;
  count: number;
}

export class Viewport {
  readonly renderer: Renderer;
  private cam = new OrbitCamera();
  private raf = 0;
  private parts: BakedPart[] = [];
  private hallPieces: HallPiece[] = [];
  private mode: ViewMode = 'assembly';
  private highlight: HighlightGpu | null = null;
  private highlightMatrix: Mat4 | null = null;
  private sceneRadius = 3000;
  private sceneCenter: Vec3 = [0, 0, 1500];
  private tooltip: HTMLElement;
  private onSelect?: (info: string | null) => void;
  private dragMoved = false;
  private lastPointer: Vec3 = [0, 0, 0];

  constructor(canvas: HTMLCanvasElement, tooltip: HTMLElement, onSelect?: (info: string | null) => void) {
    this.tooltip = tooltip;
    this.onSelect = onSelect;
    this.renderer = new Renderer(canvas, this.cam);
    this.bindInput(canvas);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragMoved = false;
      this.lastPointer = [e.clientX, e.clientY, 0];
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) {
        const dx = e.clientX - this.lastPointer[0];
        const dy = e.clientY - this.lastPointer[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
        this.cam.rotate(dx, dy);
      } else if (e.buttons & 2) {
        this.cam.pan(e.clientX - this.lastPointer[0], e.clientY - this.lastPointer[1]);
      }
      this.lastPointer = [e.clientX, e.clientY, 0];
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoom(1 + Math.sign(e.deltaY) * 0.12);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerup', (e) => {
      if (!this.dragMoved) this.handlePick(e);
    });
  }

  private handlePick(e: PointerEvent): void {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const ray = this.cam.pickRay(ndcX, ndcY);
    const hit = pick(ray, this.parts);
    const s = store.get();
    if (!hit) {
      store.patch({ selectedId: -1 });
      this.tooltip.classList.add('hidden');
      this.onSelect?.(null);
      return;
    }
    store.patch({ selectedId: hit.id });
    const bp = this.parts[hit.id];
    if (this.mode === 'assembly' || this.mode === 'hall') {
      const p = bp.part;
      const info =
        `<b>${p.name}</b><br>尺寸 ${p.size.map((x) => x.toFixed(1)).join(' × ')} mm<br>${p.spec}`;
      this.tooltip.innerHTML = info;
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
      this.tooltip.classList.remove('hidden');
      this.onSelect?.(info);
    }
    void s;
  }

  /** 加载单攒斗拱 */
  loadAssembly(): number {
    const s = store.get();
    const t0 = performance.now();
    const assembly = assemble(store.assemblyParams());
    const baked = bakeAssembly(assembly, s.explode * 300);
    this.parts = baked.parts;
    this.mode = 'assembly';
    this.renderer.uploadMesh(baked.mesh);
    this.sceneRadius = Math.max(baked.reach, baked.height) * 1.15;
    this.sceneCenter = [0, 0, baked.height / 2];
    this.cam.frame(this.sceneCenter, this.sceneRadius);
    this.buildHighlight(s.selectedId);
    const ms = performance.now() - t0;
    store.patch({ lastBuildMs: ms });
    return ms;
  }

  /** 加载整殿 */
  loadHall(mesh: MergedMesh, pieces: HallPiece[], radius: number, center: Vec3): void {
    const s = store.get();
    this.mode = 'hall';
    this.renderer.uploadMesh(mesh);
    // 整殿拾取体:由 HallPiece 的 OBB 构造
    this.parts = pieces.map((pc, i) => ({
      part: {
        id: i, kind: pc.kind as never, name: pc.name, size: pc.size, matrix: pc.matrix,
        material: pc.material, layer: pc.layer, radial: pc.radial, count: 1, spec: pc.spec,
      },
      obb: {
        center: [0, 0, 0],
        half: [pc.size[0] / 2, pc.size[1] / 2, pc.size[2] / 2] as Vec3,
        matrix: pc.matrix, invMatrix: pc.matrix.invert(),
      },
      exploded: pc.matrix,
    }));
    this.sceneRadius = radius;
    this.sceneCenter = center;
    this.cam.frame(center, radius);
    this.buildHighlight(s.selectedId);
  }

  /** 为选中构件单独构建一个 GPU 网格用于高亮覆盖 */
  private buildHighlight(id: number): void {
    const gl = this.renderer.gl;
    if (this.highlight) {
      gl.deleteVertexArray(this.highlight.vao);
      this.highlight = null;
      this.highlightMatrix = null;
    }
    if (id < 0 || id >= this.parts.length) return;
    const bp = this.parts[id];
    let geo: RawGeometry;
    if (this.mode === 'assembly') {
      const placements = assemblyGeometries(store.assemblyParams());
      geo = placements[id].geo.geo;
    } else {
      geo = this.hallPieces[id]?.geo ?? createRaw();
    }
    if (geo.indices.length === 0) return;
    const partMatrix = store.get().explode > 0 && this.mode === 'assembly'
      ? explodeMatrix(bp.part, store.get().explode * 300)
      : bp.part.matrix;
    const merged = mergePieces([{ geo, matrix: partMatrix, material: 'wood' }]);
    // 高亮网格直接把变换烘焙进顶点
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attr = (index: number, data: Float32Array, size: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
    };
    attr(0, merged.positions, 3);
    attr(1, merged.normals, 3);
    attr(2, merged.uvs, 2);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, merged.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.highlight = { vao, count: merged.indices.length };
    this.highlightMatrix = Mat4.identity();
  }

  refreshHighlight(): void {
    this.buildHighlight(store.get().selectedId);
  }

  setHallPieces(pieces: HallPiece[]): void {
    this.hallPieces = pieces;
  }

  refreshTextures(): void {
    this.renderer.refreshTextures();
  }

  private draw(): void {
    const s = store.get();
    this.renderer.render(
      {
        wireframe: s.wireframe, ssao: s.ssao, shadows: s.shadows,
        highlightId: s.selectedId,
      },
      this.sceneRadius, this.sceneCenter,
      this.highlightMatrix, this.highlight?.count ?? 0, this.highlight?.vao ?? null,
    );
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
