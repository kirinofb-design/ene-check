import {
  fetchCollectPostJsonWithRetries,
  runFusionSolarDayWindowChunks,
  runLaplaceDayChunks,
  runSmaDayChunks,
} from "@/lib/browserChunkCollectors";

import {
  FUSION_SOLAR_FULL_RANGE_POST_URL,
  getLaplaceChunkDelayMs,
  getLaplaceDaysPerChunk,
  getOrchestrationChillMs,
  getSmaChunkDelayMs,
  getSmaDaysPerChunk,
  shouldPrewarmBetweenCollectorsClient,
  shouldSplitFusionByStationClient,
} from "@/lib/collectClientEnv";

const FUSION_SOLAR_STATION_POST_URL = "/api/collect/fusion-solar/station";
const FUSION_SOLAR_WINDOW_POST_URL = "/api/collect/fusion-solar/window";
const COLLECT_PREWARM_URL = "/api/collect/prewarm";

function sleepClientOrchestration(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function prewarmCollectChromium(signal: AbortSignal): Promise<void> {
  if (!shouldPrewarmBetweenCollectorsClient()) return;
  await fetch(COLLECT_PREWARM_URL, { method: "POST", signal }).catch(() => {});
}

/** サーバ一括の allProgress と揃えた「データ取得」段階数（finalize は post-finalize で表示） */
export const CLIENT_FULL_COLLECT_TOTAL_STEPS = 6;

export type ClientAllCollectProgress = {
  completedSteps: number;
  totalSteps: number;
  currentStepKey: string;
  /** チャンク取得中の補足（例: ラプラス 2/4 区間） */
  detail?: string;
};

export type ClientAllCollectStep = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

/**
 * Vercel 等で `POST /api/collect/all` が 504 になりやすいとき用。
 * ブラウザから各収集 API を順に呼び、最後に finalize（後処理・ミラー同期）を 1 回実行する。
 */
export async function runClientFullCollectOrchestration(params: {
  range: { startDate: string; endDate: string };
  signal: AbortSignal;
  endpointBySystem: Record<string, string>;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onProgress?: (p: ClientAllCollectProgress) => void;
}): Promise<{ steps: ClientAllCollectStep[]; interrupted: boolean; mirrorAppend: string }> {
  const { range, signal, endpointBySystem, resolveApiMessage, onProgress } = params;
  const steps: ClientAllCollectStep[] = [];
  let interrupted = false;
  const chillMs = getOrchestrationChillMs();

  const isAbortError = (e: unknown): boolean =>
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError");

  const fetchOneSystemStep = async (spec: { key: string; button: string }): Promise<void> => {
    const endpoint = endpointBySystem[spec.button];
    if (!endpoint) {
      steps.push({
        key: spec.key,
        ok: false,
        message: "内部エラー: 収集エンドポイントが未定義です。",
        recordCount: 0,
        errorCount: 0,
      });
      return;
    }
    let response: Response;
    let data: unknown = null;
    try {
      const out = await fetchCollectPostJsonWithRetries({
        url: endpoint,
        body: { startDate: range.startDate, endDate: range.endDate },
        signal,
        maxAttempts: 5,
      });
      response = out.res;
      data = out.data;
    } catch (e) {
      if (isAbortError(e)) {
        interrupted = true;
        return;
      }
      steps.push({
        key: spec.key,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        recordCount: 0,
        errorCount: 0,
      });
      return;
    }
    const message = resolveApiMessage(
      data,
      response.ok ? "処理が完了しました。" : `APIエラーが発生しました（HTTP ${response.status}）`,
      response.status
    );
    steps.push({
      key: spec.key,
      ok: Boolean(response.ok && data && typeof data === "object" && (data as { ok?: boolean }).ok),
      message,
      recordCount:
        data && typeof data === "object" && typeof (data as { recordCount?: unknown }).recordCount === "number"
          ? (data as { recordCount: number }).recordCount
          : 0,
      errorCount:
        data && typeof data === "object" && typeof (data as { errorCount?: unknown }).errorCount === "number"
          ? (data as { errorCount: number }).errorCount
          : 0,
    });
  };

  const notify = (completedSteps: number, currentStepKey: string, detail?: string) => {
    onProgress?.({
      completedSteps,
      totalSteps: CLIENT_FULL_COLLECT_TOTAL_STEPS,
      currentStepKey,
      detail,
    });
  };

  const chill = async (ms: number) => {
    if (interrupted || signal.aborted) return;
    try {
      await sleepClientOrchestration(ms, signal);
    } catch {
      interrupted = true;
    }
  };

  if (signal.aborted) interrupted = true;
  if (!interrupted && !signal.aborted) {
    notify(0, "eco-megane");
    await fetchOneSystemStep({ key: "eco-megane", button: "eco-megane" });
  }
  if (!interrupted && !signal.aborted) {
    await chill(chillMs.afterEco);
    await prewarmCollectChromium(signal);
  }
  if (!interrupted && !signal.aborted) {
    notify(1, "sma");
    const sma = await runSmaDayChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      smaPostUrl: endpointBySystem.SMA,
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
      maxDaysPerChunk: getSmaDaysPerChunk(),
      betweenChunksMs: getSmaChunkDelayMs(),
      onChunkProgress: (p) => notify(1, "sma", `SMA ${p.chunkIndex}/${p.chunkTotal}（${p.label}）`),
    });
    steps.push(sma.step);
    if (sma.flowAborted) interrupted = true;
  }
  if (!interrupted && !signal.aborted) {
    await chill(chillMs.afterSma);
    await prewarmCollectChromium(signal);
  }
  if (!interrupted && !signal.aborted) {
    notify(2, "laplace");
    const lap = await runLaplaceDayChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      laplacePostUrl: endpointBySystem.ラプラス,
      prewarmPostUrl: COLLECT_PREWARM_URL,
      maxDaysPerChunk: getLaplaceDaysPerChunk(),
      betweenChunksMs: getLaplaceChunkDelayMs(),
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
      onChunkProgress: (p) => notify(2, "laplace", `ラプラス ${p.chunkIndex}/${p.chunkTotal}（${p.label}）`),
    });
    steps.push(lap.step);
    if (lap.flowAborted) interrupted = true;
  }
  if (!interrupted && !signal.aborted) {
    await chill(chillMs.afterLaplace);
  }
  if (!interrupted && !signal.aborted) {
    notify(3, "solar-monitor-sf");
    await fetchOneSystemStep({ key: "solar-monitor-sf", button: "池新田・本社" });
  }
  if (!interrupted && !signal.aborted) {
    await chill(chillMs.betweenMonitors);
  }
  if (!interrupted && !signal.aborted) {
    notify(4, "solar-monitor-se");
    await fetchOneSystemStep({ key: "solar-monitor-se", button: "須山" });
  }
  if (!interrupted && !signal.aborted) {
    await chill(chillMs.beforeFusion);
    await prewarmCollectChromium(signal);
    await chill(2000);
    await prewarmCollectChromium(signal);
  }
  if (!interrupted && !signal.aborted) {
    notify(5, "fusion-solar");
    const fus = await runFusionSolarDayWindowChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      stationPostUrl: FUSION_SOLAR_STATION_POST_URL,
      windowPostUrl: FUSION_SOLAR_WINDOW_POST_URL,
      fullRangePostUrl: FUSION_SOLAR_FULL_RANGE_POST_URL,
      splitByStation: shouldSplitFusionByStationClient(),
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
      onChunkProgress: (p) =>
        notify(5, "fusion-solar", `FusionSolar ${p.chunkIndex}/${p.chunkTotal}（${p.label}）`),
    });
    steps.push(fus.step);
    if (fus.flowAborted) interrupted = true;
  }

  let mirrorAppend = "";
  if (!interrupted && !signal.aborted) {
    notify(6, "post-finalize");
    try {
      const { res: fres, data: fdata } = await fetchCollectPostJsonWithRetries({
        url: "/api/collect/all/finalize",
        body: { startDate: range.startDate, endDate: range.endDate },
        signal,
        maxAttempts: 4,
      });
      if (!fres.ok || !fdata || typeof fdata !== "object" || !(fdata as { ok?: boolean }).ok) {
        mirrorAppend = `\n\n──────── 後処理 ────────\n${resolveApiMessage(
          fdata,
          `後処理 API が失敗しました（HTTP ${fres.status}）`,
          fres.status
        )}`;
      } else {
        const ms = (fdata as { mirrorSync?: unknown }).mirrorSync;
        if (ms && typeof ms === "object") {
          const m = ms as { ok?: boolean; upserted?: number; skippedNoMirrorSite?: number; message?: string };
          mirrorAppend = `\n\n──────── ミラーDB同期 ────────\n${
            m.ok
              ? `成功（反映 ${Number(m.upserted ?? 0)} 件 / ミラー側に無いサイトでスキップ ${Number(
                  m.skippedNoMirrorSite ?? 0
                )} 件）`
              : `失敗: ${String(m.message ?? "不明なエラー")}`
          }`;
        }
      }
    } catch (fe) {
      if (isAbortError(fe)) {
        interrupted = true;
        mirrorAppend =
          "\n\n──────── 後処理 ────────\n中断のため、強制0ルール適用とミラー同期は実行していません。";
      } else {
        mirrorAppend = `\n\n──────── 後処理 ────────\n${fe instanceof Error ? fe.message : String(fe)}`;
      }
    }
  } else {
    mirrorAppend =
      "\n\n──────── 後処理 ────────\n中断のため、強制0ルール適用とミラー同期は実行していません。";
  }

  return { steps, interrupted, mirrorAppend };
}
