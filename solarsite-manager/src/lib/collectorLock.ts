type CollectorKind = "all" | "sma";

type LockState = {
  allRunning: boolean;
  smaRunning: boolean;
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
  const next: LockState = { allRunning: false, smaRunning: false };
  stateMap.set(userId, next);
  return next;
}

export function acquireCollectorLock(
  userId: string,
  kind: CollectorKind
): { ok: true } | { ok: false; message: string } {
  const state = getOrCreateState(userId);

  // all は他処理と排他、sma も all と排他
  if (kind === "all") {
    if (state.allRunning || state.smaRunning) {
      return {
        ok: false,
        message: "他の収集処理が実行中です。完了してから「全データ一括取得」を実行してください。",
      };
    }
    state.allRunning = true;
    return { ok: true };
  }

  if (state.allRunning || state.smaRunning) {
    return {
      ok: false,
      message: "他の収集処理が実行中です。完了してから「SMA収集」を実行してください。",
    };
  }
  state.smaRunning = true;
  return { ok: true };
}

export function releaseCollectorLock(userId: string, kind: CollectorKind): void {
  const state = stateMap.get(userId);
  if (!state) return;

  if (kind === "all") state.allRunning = false;
  if (kind === "sma") state.smaRunning = false;

  if (!state.allRunning && !state.smaRunning) {
    stateMap.delete(userId);
  }
}
