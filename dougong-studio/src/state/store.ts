import { AssemblyParams, Cai, HallParams, KeType, MaterialId } from '../dougong/types';

export interface AppState {
  doukou: number;
  cai: Cai;
  ke: KeType;
  wireframe: boolean;
  ssao: boolean;
  shadows: boolean;
  explode: number; // 0~1
  selectedId: number;
  hall: Omit<HallParams, 'doukou' | 'cai' | 'ke'>;
  materialOverride: MaterialId | 'mixed';
  lastBuildMs: number;
}

type Listener = (s: AppState) => void;

const initial: AppState = {
  doukou: 90,
  cai: 9,
  ke: 'pingshen',
  wireframe: false,
  ssao: true,
  shadows: true,
  explode: 0,
  selectedId: -1,
  hall: {
    bays: 3,
    depths: 2,
    bayWidth: 90 * 11 * 3, // 明间按 11d×攒数估算
    depthWidth: 90 * 11 * 2,
    columnHeight: 90 * 70 / 10, // 约 70 斗口檐柱高
  },
  materialOverride: 'mixed',
  lastBuildMs: 0,
};

class Store {
  state: AppState = { ...initial, hall: { ...initial.hall } };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  get(): AppState {
    return this.state;
  }
  patch(p: Partial<AppState>): void {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn(this.state));
  }
  patchHall(p: Partial<AppState['hall']>): void {
    this.state = { ...this.state, hall: { ...this.state.hall, ...p } };
    this.listeners.forEach((fn) => fn(this.state));
  }
  assemblyParams(): AssemblyParams {
    return { doukou: this.state.doukou, cai: this.state.cai, ke: this.state.ke };
  }
  hallParams(): HallParams {
    return { ...this.state.hall, doukou: this.state.doukou, cai: this.state.cai, ke: this.state.ke };
  }
}

export const store = new Store();
