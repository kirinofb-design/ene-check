import {
  fetchCollectPostJsonWithRetries,
  runFusionSolarDayWindowChunks,
  runLaplaceDayChunks,
  runSmaDayChunks,
} from "@/lib/browserChunkCollectors";

const FUSION_SOLAR_WINDOW_POST_URL = "/api/collect/fusion-solar/window";
const COLLECT_PREWARM_URL = "/api/collect/prewarm";
const LAPLACE_DAY_CHUNK = 5;
const SMA_DAY_CHUNK = 2;

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
}): Promise<{ steps: ClientAllCollectStep[]; interrupted: boolean; mirrorAppend: string }> {
  const { range, signal, endpointBySystem, resolveApiMessage } = params;
  const steps: ClientAllCollectStep[] = [];
  let interrupted = false;

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
        maxAttempts: 4,
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

  if (signal.aborted) interrupted = true;
  if (!interrupted && !signal.aborted) {
    await fetchOneSystemStep({ key: "eco-megane", button: "eco-megane" });
  }
  if (!interrupted && !signal.aborted) {
    const sma = await runSmaDayChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      smaPostUrl: endpointBySystem.SMA,
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
      maxDaysPerChunk: SMA_DAY_CHUNK,
    });
    steps.push(sma.step);
    if (sma.flowAborted) interrupted = true;
  }
  if (!interrupted && !signal.aborted) {
    const lap = await runLaplaceDayChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      laplacePostUrl: endpointBySystem.ラプラス,
      prewarmPostUrl: COLLECT_PREWARM_URL,
      maxDaysPerChunk: LAPLACE_DAY_CHUNK,
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
    });
    steps.push(lap.step);
    if (lap.flowAborted) interrupted = true;
  }
  if (!interrupted && !signal.aborted) {
    await fetchOneSystemStep({ key: "solar-monitor-sf", button: "池新田・本社" });
  }
  if (!interrupted && !signal.aborted) {
    await fetchOneSystemStep({ key: "solar-monitor-se", button: "須山" });
  }
  if (!interrupted && !signal.aborted) {
    const fus = await runFusionSolarDayWindowChunks({
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      signal,
      windowPostUrl: FUSION_SOLAR_WINDOW_POST_URL,
      resolveApiMessage,
      onSetInterrupted: (v) => {
        interrupted = v;
      },
    });
    steps.push(fus.step);
    if (fus.flowAborted) interrupted = true;
  }

  let mirrorAppend = "";
  if (!interrupted && !signal.aborted) {
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
