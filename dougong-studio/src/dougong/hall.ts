import { Mat4, Vec3 } from '../core/math';
import { addBox, addCylinder, createRaw, MergePiece, MergedMesh, mergePieces } from './geometry';
import { HallParams, MaterialId, PartInstance } from './types';
import { assemblyGeometries, Placement } from './assembly';
import { ZHUAJIA, jumpsOf } from './dims';

export interface HallPiece {
  name: string;
  size: Vec3;
  matrix: Mat4;
  material: MaterialId;
  kind: PartInstance['kind'] | 'column' | 'purlin' | 'beam';
  layer: number;
  radial: Vec3;
  spec: string;
  geo: MergePiece['geo'];
}

export interface HallScene {
  pieces: HallPiece[];
  /** 柱网轴线交点(用于线框/参考显示) */
  columnPoints: Vec3[];
  footprint: { x: number; y: number };
}

/**
 * 整殿模型:矩形柱网 + 平板枋 + 檐檩 + 周边斗拱。
 * 所有尺寸由斗口 d 线性导出,改 d 后整体重建,保证联动一致。
 */
export function buildHall(p: HallParams): HallScene {
  const d = p.doukou;
  const n = jumpsOf(p.cai);
  const pieces: HallPiece[] = [];
  const colPts: Vec3[] = [];

  const nx = p.bays;            // x 向开间数
  const ny = p.depths;          // y 向进深间数
  const Lx = p.bayWidth * nx;
  const Ly = p.depthWidth * ny;
  const colR = 0.5 * d * 1.2;   // 檐柱径约 6 斗口(半径 0.6d)
  const colH = p.columnHeight;

  // 1) 柱网
  const colGeo = createRaw();
  addCylinder(colGeo, [0, 0, 0], colR, colH, 18, 'z');
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = -Lx / 2 + i * p.bayWidth;
      const y = -Ly / 2 + j * p.depthWidth;
      colPts.push([x, y, 0]);
      pieces.push({
        name: `檐柱(${i + 1},${j + 1})`, size: [colR * 2, colR * 2, colH],
        matrix: Mat4.translation(x, y, colH / 2), material: 'wood',
        kind: 'column', layer: 0, radial: [0, 0, 0],
        spec: `柱径 ${(colR * 2).toFixed(1)}mm × 高 ${colH}mm`, geo: colGeo,
      });
    }
  }

  // 2) 平板枋(柱顶通长),高 2d、宽 3.5d
  const bandH = 2 * d, bandW = 3.5 * d;
  const bandX = createRaw();
  addBox(bandX, 0, 0, bandH / 2, Lx + bandW, bandW, bandH);
  const bandY = createRaw();
  addBox(bandY, 0, 0, bandH / 2, Ly + bandW, bandW, bandH);
  pieces.push({
    name: '平板枋(面阔)', size: [Lx + bandW, bandW, bandH],
    matrix: Mat4.translation(0, -Ly / 2, colH), material: 'wood', kind: 'beam',
    layer: 0, radial: [0, -1, 0], spec: `平板枋 ${bandW.toFixed(0)}×${bandH.toFixed(0)}mm`, geo: bandX,
  });
  pieces.push({
    name: '平板枋(面阔)', size: [Lx + bandW, bandW, bandH],
    matrix: Mat4.translation(0, Ly / 2, colH), material: 'wood', kind: 'beam',
    layer: 0, radial: [0, 1, 0], spec: `平板枋`, geo: bandX,
  });
  pieces.push({
    name: '平板枋(进深)', size: [Ly + bandW, bandW, bandH],
    matrix: Mat4.compose([-Lx / 2, 0, colH], Math.PI / 2, [1, 1, 1]),
    material: 'wood', kind: 'beam', layer: 0, radial: [-1, 0, 0], spec: '平板枋', geo: bandY,
  });
  pieces.push({
    name: '平板枋(进深)', size: [Ly + bandW, bandW, bandH],
    matrix: Mat4.compose([Lx / 2, 0, colH], Math.PI / 2, [1, 1, 1]),
    material: 'wood', kind: 'beam', layer: 0, radial: [1, 0, 0], spec: '平板枋', geo: bandY,
  });

  // 3) 周边斗拱:角科 4 座、柱头科位于柱顶、其余均布平身科
  const bracketBaseZ = colH + bandH;
  const spacing = 11 * d; // 平身科档距约 11 斗口
  const placeBracket = (x: number, y: number, ke: HallParams['ke'], rotZ: number) => {
    const placements: Placement[] = assemblyGeometries({ doukou: d, cai: p.cai, ke });
    for (const pl of placements) {
      const m = Mat4.multiply(
        Mat4.translation(x, y, bracketBaseZ),
        Mat4.multiply(Mat4.rotationZ(rotZ), pl.matrix),
      );
      pieces.push({
        name: pl.name, size: pl.size, matrix: m, material: pl.material,
        kind: pl.kind, layer: pl.layer + 1, radial: pl.radial, spec: pl.spec, geo: pl.geo.geo,
      });
    }
  };

  // 角科(四角)
  const corners: Vec3[] = [
    [-Lx / 2, -Ly / 2, 0], [Lx / 2, -Ly / 2, 0], [Lx / 2, Ly / 2, 0], [-Lx / 2, Ly / 2, 0],
  ];
  corners.forEach((c, idx) => placeBracket(c[0], c[1], 'jiao', (idx * Math.PI) / 2));

  // 柱头科(柱位上,跳过四角)
  for (let i = 1; i < nx; i++) {
    placeBracket(-Lx / 2 + i * p.bayWidth, -Ly / 2, 'zhutou', 0);
    placeBracket(-Lx / 2 + i * p.bayWidth, Ly / 2, 'zhutou', Math.PI);
  }
  for (let j = 1; j < ny; j++) {
    placeBracket(-Lx / 2, -Ly / 2 + j * p.depthWidth, 'zhutou', -Math.PI / 2);
    placeBracket(Lx / 2, -Ly / 2 + j * p.depthWidth, 'zhutou', Math.PI / 2);
  }

  // 平身科(柱间均布,数量按档距折算)
  const fillSpan = (span: number, fixedAt: (t: number) => void) => {
    const count = Math.max(1, Math.round(span / spacing) - 1);
    for (let k = 1; k <= count; k++) {
      const t = (k / (count + 1)) * span;
      fixedAt(t);
    }
  };
  for (let i = 0; i < nx; i++) {
    const x0 = -Lx / 2 + i * p.bayWidth;
    fillSpan(p.bayWidth, (t) => {
      placeBracket(x0 + t, -Ly / 2, 'pingshen', 0);
      placeBracket(x0 + t, Ly / 2, 'pingshen', Math.PI);
    });
  }
  for (let j = 0; j < ny; j++) {
    const y0 = -Ly / 2 + j * p.depthWidth;
    fillSpan(p.depthWidth, (t) => {
      placeBracket(-Lx / 2, y0 + t, 'pingshen', -Math.PI / 2);
      placeBracket(Lx / 2, y0 + t, 'pingshen', Math.PI / 2);
    });
  }

  // 4) 檐檩:最外跳跳头上,半径 1.5d
  const purlinR = 1.5 * d;
  const reach = ZHUAJIA * n * d;
  const purlinGeo = createRaw();
  addCylinder(purlinGeo, [0, 0, 0], purlinR, Lx + 2 * reach, 20, 'x');
  const purlinGeoY = createRaw();
  addCylinder(purlinGeoY, [0, 0, 0], purlinR, Ly + 2 * reach, 20, 'y');
  const purlinZ = bracketBaseZ + (2 * n + 3) * 2 * d + reach * 0.15;
  for (const sy of [-1, 1]) {
    pieces.push({
      name: '檐檩(面阔)', size: [Lx + 2 * reach, purlinR * 2, purlinR * 2],
      matrix: Mat4.translation(0, sy * (Ly / 2 + reach), purlinZ),
      material: 'wood', kind: 'purlin', layer: 0, radial: [0, sy, 0],
      spec: `檐檩 径 ${(purlinR * 2).toFixed(0)}mm`, geo: purlinGeo,
    });
  }
  for (const sx of [-1, 1]) {
    pieces.push({
      name: '檐檩(进深)', size: [purlinR * 2, Ly + 2 * reach, purlinR * 2],
      matrix: Mat4.translation(sx * (Lx / 2 + reach), 0, purlinZ),
      material: 'wood', kind: 'purlin', layer: 0, radial: [sx, 0, 0],
      spec: `檐檩 径 ${(purlinR * 2).toFixed(0)}mm`, geo: purlinGeoY,
    });
  }

  return { pieces, columnPoints: colPts, footprint: { x: Lx, y: Ly } };
}

export function mergeHall(scene: HallScene): { mesh: MergedMesh; pieces: HallPiece[] } {
  const mp: MergePiece[] = scene.pieces.map((pc) => ({
    geo: pc.geo, matrix: pc.matrix, material: pc.material,
  }));
  return { mesh: mergePieces(mp), pieces: scene.pieces };
}
