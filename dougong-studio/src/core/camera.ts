import { Mat4, Ray, Vec3, clamp, normalize, sub } from './math';

/** 球面轨道相机:z 轴为竖直方向 */
export class OrbitCamera {
  target: Vec3 = [0, 0, 0];
  distance = 4000;
  yaw = Math.PI * 0.25;
  pitch = 0.55;
  fov = Math.PI / 5;
  near = 10;
  far = 200000;
  aspect = 1;

  frame(center: Vec3, radius: number): void {
    this.target = center;
    this.distance = radius / Math.sin(this.fov / 2) * 1.25;
    this.near = Math.max(1, this.distance / 500);
    this.far = this.distance * 20;
  }

  eye(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.cos(this.yaw),
      this.target[1] + this.distance * cp * Math.sin(this.yaw),
      this.target[2] + this.distance * Math.sin(this.pitch),
    ];
  }

  view(): Mat4 {
    return Mat4.lookAt(this.eye(), this.target);
  }
  proj(): Mat4 {
    return Mat4.perspective(this.fov, this.aspect, this.near, this.far);
  }
  viewProj(): Mat4 {
    return Mat4.multiply(this.proj(), this.view());
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = clamp(this.pitch + dy * 0.005, -1.35, 1.45);
  }
  zoom(ratio: number): void {
    this.distance = clamp(this.distance * ratio, 50, 100000);
  }
  pan(dx: number, dy: number): void {
    const eye = this.eye();
    const f = normalize(sub(this.target, eye));
    const right = normalize([-f[1], f[0], 0]);
    const up: Vec3 = [0, 0, 1];
    const k = this.distance * 0.0016;
    this.target = [
      this.target[0] + (right[0] * -dx + up[0] * dy) * k,
      this.target[1] + (right[1] * -dx + up[1] * dy) * k,
      this.target[2] + (right[2] * -dx + up[2] * dy) * k,
    ];
  }

  /** 屏幕像素 -> 世界射线 */
  pickRay(ndcX: number, ndcY: number): Ray {
    const vpInv = this.viewProj().invert();
    const nearP = vpInv.transformPoint([ndcX, ndcY, -1]);
    const farP = vpInv.transformPoint([ndcX, ndcY, 1]);
    return { origin: nearP, dir: normalize(sub(farP, nearP)) };
  }
}
