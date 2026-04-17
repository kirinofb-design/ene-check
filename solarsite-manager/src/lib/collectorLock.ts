export type CollectorKind =
  | "all"
  | "sma"
  | "eco-megane"
  | "fusion-solar"
  | "laplace"
  | "solar-monitor-sf"
  | "solar-monitor-se";

type LockState = {
  allRunning: boolean;
  smaRunning: boolean;
  runningKind: CollectorKind | null;
  allCancelRequested: boolean;
};

const globalKey = "__collector_lock_state__";
const stateMap: Map<string, LockState> = (() => {
  const g = globalThis as unknown as Record<string, Map<string, LockState> | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = new Map<string, LockState>();
  }
  return g[globalKey]!;
})();

function getOrCreateState(userId: string): LockState {
  const existing = stateMap.get(userId);
  if (existing) return existing;
  const next: LockState = {
    allRunning: false,
    smaRunning: false,
    runningKind: null,
    allCancelRequested: false,
  };
  stateMap.set(userId, next);
  return next;
}

function labelByKind(kind: CollectorKind): string {
  switch (kind) {
    case "all":
      return "全データ一括取得";
    case "sma":
      return "SMA収集";
    case "eco-megane":
      return "eco-megane収集";
    case "fusion-solar":
      return "FusionSolar収集";
    case "laplace":
      return "ラプラス収集";
    case "solar-monitor-sf":
      return "Solar Monitor（池新田・本社）収集";
    case "solar-monitor-se":
      return "Solar Monitor（須山）収集";
    default:
      return "データ収集";
  }
}

export function acquireCollectorLock(
  userId: string,
  kind: CollectorKind
): { ok: true } | { ok: false; message: string } {
  const state = getOrCreateState(userId);
  if (state.runningKind !== null) {
    return {
      ok: false,
      message: `他の収集処理（${labelByKind(state.runningKind)}）が実行中です。完了してから「${labelByKind(
        kind
      )}」を実行してください。`,
    };
  }

  state.runningKind = kind;
  state.allRunning = kind === "all";
  state.smaRunning = kind === "sma";
  state.allCancelRequested = false;
  return { ok: true };
}

export function releaseCollectorLock(userId: string, kind: CollectorKind): void {
  const state = stateMap.get(userId);
  if (!state) return;

  // 別処理の誤解放を防ぐ
  if (state.runningKind !== kind) return;

  state.runningKind = null;
  state.allRunning = false;
  state.smaRunning = false;
  state.allCancelRequested = false;
  if (!state.runningKind) {
    stateMap.delete(userId);
  }
}

export function getCollectorLockState(userId: string): LockState {
  const state = stateMap.get(userId);
  if (!state) return { allRunning: false, smaRunning: false, runningKind: null, allCancelRequested: false };
  return { ...state };
}

export function requestCollectorCancel(
  userId: string,
  kind: CollectorKind
): { ok: true; accepted: boolean } | { ok: false; message: string } {
  const state = stateMap.get(userId);
  if (!state) return { ok: true, accepted: false };
  if (kind === "all") {
    if (!state.runningKind) return { ok: true, accepted: false };
    state.allCancelRequested = true;
    return { ok: true, accepted: true };
  }
  return { ok: false, message: "未対応のキャンセル種別です。" };
}

export function isCollectorCancelRequested(userId: string, kind: CollectorKind): boolean {
  const state = stateMap.get(userId);
  if (!state) return false;
  if (kind === "all") return state.allCancelRequested;
  return false;
}
