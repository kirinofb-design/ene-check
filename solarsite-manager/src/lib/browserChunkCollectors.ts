import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";
import { eachMaxDaySliceInRange } from "@/lib/collectDateChunks";

const TRANSIENT_HTTP = new Set([408, 429, 502, 503, 504, 524]);

function looksLikeTransientFailureMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("504") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("gateway") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("econnreset") ||
    m.includes("socket hang up") ||
    m.includes("fetch failed") ||
    m.includes("database server") ||
    m.includes("p1001") ||
    m.includes("too many requests") ||
    m.includes("rate limit")
  );
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
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

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** ブラウザから収集 API を叩く共通処理。ゲートウェイ・一時障害時に指数バックオフで再試行する。 */
export async function fetchCollectPostJsonWithRetries(params: {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  maxAttempts?: number;
}): Promise<{ res: Response; data: unknown }> {
  const maxAttempts = params.maxAttempts ?? 3;
  let lastRes!: Response;
  let lastData: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lastRes = await fetch(params.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.body),
        signal: params.signal,
      });
      try {
        lastData = await lastRes.json();
      } catch {
        const text = await lastRes.text().catch(() => "");
        lastData = { message: text || null };
      }
      const ok =
        lastRes.ok &&
        lastData &&
        typeof lastData === "object" &&
        Boolean((lastData as { ok?: boolean }).ok);
      if (ok) return { res: lastRes, data: lastData };
      const msg =
        lastData && typeof lastData === "object" && typeof (lastData as { message?: unknown }).message === "string"
          ? (lastData as { message: string }).message
          : "";
      const retryable =
        TRANSIENT_HTTP.has(lastRes.status) || looksLikeTransientFailureMessage(msg);
      if (!retryable || attempt >= maxAttempts) {
        return { res: lastRes, data: lastData };
      }
      await sleep(1500 * attempt, params.signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (attempt >= maxAttempts) throw e;
      await sleep(1500 * attempt, params.signal);
    }
  }
  return { res: lastRes, data: lastData };
}

export type ChunkCollectStep = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

/** ブラウザからのみ import すること（fetch を使用） */
export async function runFusionSolarDayWindowChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  windowPostUrl: string;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
}): Promise<{ step: ChunkCollectStep; flowAborted: boolean }> {
  /** 1日＝1リクエスト（サーバ側で全発電所をまとめて処理しログインは1回／日） */
  const slices = eachMaxDaySliceInRange(params.rangeStart, params.rangeEnd, 1);
  if (slices.length === 0) {
    return {
      step: { key: "fusion-solar", ok: false, message: "日付範囲が不正です。", recordCount: 0, errorCount: 0 },
      flowAborted: false,
    };
  }

  let totalRec = 0;
  let totalErr = 0;
  const failures: string[] = [];
  let reqIndex = 0;

  for (const sl of slices) {
    if (params.signal.aborted) {
      params.onSetInterrupted(true);
      return {
        step: {
          key: "fusion-solar",
          ok: failures.length === 0,
          message:
            failures.length > 0
              ? `中断。一部失敗:\n${failures.join("\n")}`
              : "FusionSolar 取得が中断されました。",
          recordCount: totalRec,
          errorCount: totalErr,
        },
        flowAborted: true,
      };
    }

    if (reqIndex > 0) {
      await new Promise((r) => setTimeout(r, 650));
    }
    reqIndex++;

    let res: Response;
    let data: unknown = null;
    try {
      const out = await fetchCollectPostJsonWithRetries({
        url: params.windowPostUrl,
        body: { startDate: sl.startDate, endDate: sl.endDate },
        signal: params.signal,
      });
      res = out.res;
      data = out.data;
    } catch (e) {
      if (isAbortError(e)) {
        params.onSetInterrupted(true);
        return {
          step: {
            key: "fusion-solar",
            ok: false,
            message:
              failures.length > 0
                ? `中断。一部失敗:\n${failures.join("\n")}`
                : "FusionSolar 取得が中断されました。",
            recordCount: totalRec,
            errorCount: totalErr,
          },
          flowAborted: true,
        };
      }
      failures.push(`${sl.startDate}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const ok = res.ok && data && typeof data === "object" && Boolean((data as { ok?: boolean }).ok);
    const msg = params.resolveApiMessage(
      data,
      res.ok ? "処理が完了しました。" : `APIエラー（HTTP ${res.status}）`,
      res.status
    );
    const rec =
      data && typeof data === "object" && typeof (data as { recordCount?: unknown }).recordCount === "number"
        ? (data as { recordCount: number }).recordCount
        : 0;
    const err =
      data && typeof data === "object" && typeof (data as { errorCount?: unknown }).errorCount === "number"
        ? (data as { errorCount: number }).errorCount
        : 0;
    totalRec += rec;
    totalErr += err;
    if (!ok) {
      failures.push(`${sl.startDate}: ${msg}`);
    }
  }

  return {
    step: {
      key: "fusion-solar",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `FusionSolar: 全日を1日単位（${slices.length}回）に分け、各回で全${FUSION_SOLAR_STATIONS.length}発電所を取得しました。`
          : `FusionSolar: 一部失敗（${failures.length}件）。\n${failures.slice(0, 10).join("\n")}${
              failures.length > 10 ? "\n…他省略" : ""
            }`,
      recordCount: totalRec,
      errorCount: totalErr,
    },
    flowAborted: false,
  };
}

/** SMA は期間が長いと1リクエストが Vercel Hobby のゲートウェイ（約10秒）を超え 504 になりやすい。暦日で分割する。 */
const SMA_DAYS_PER_CHUNK_DEFAULT = 3;

export async function runSmaDayChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  smaPostUrl: string;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
  maxDaysPerChunk?: number;
}): Promise<{ step: ChunkCollectStep; flowAborted: boolean }> {
  const span = params.maxDaysPerChunk ?? SMA_DAYS_PER_CHUNK_DEFAULT;
  const slices = eachMaxDaySliceInRange(params.rangeStart, params.rangeEnd, span);
  if (slices.length === 0) {
    return {
      step: { key: "sma", ok: false, message: "日付範囲が不正です。", recordCount: 0, errorCount: 0 },
      flowAborted: false,
    };
  }

  let totalRec = 0;
  let totalErr = 0;
  const failures: string[] = [];
  let reqIndex = 0;

  for (const sl of slices) {
    if (params.signal.aborted) {
      params.onSetInterrupted(true);
      return {
        step: {
          key: "sma",
          ok: failures.length === 0,
          message:
            failures.length > 0
              ? `中断。一部失敗:\n${failures.join("\n")}`
              : "SMA 取得が中断されました。",
          recordCount: totalRec,
          errorCount: totalErr,
        },
        flowAborted: true,
      };
    }

    if (reqIndex > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    reqIndex++;

    let res: Response;
    let data: unknown = null;
    try {
      const out = await fetchCollectPostJsonWithRetries({
        url: params.smaPostUrl,
        body: { startDate: sl.startDate, endDate: sl.endDate },
        signal: params.signal,
        maxAttempts: 4,
      });
      res = out.res;
      data = out.data;
    } catch (e) {
      if (isAbortError(e)) {
        params.onSetInterrupted(true);
        return {
          step: {
            key: "sma",
            ok: false,
            message:
              failures.length > 0
                ? `中断。一部失敗:\n${failures.join("\n")}`
                : "SMA 取得が中断されました。",
            recordCount: totalRec,
            errorCount: totalErr,
          },
          flowAborted: true,
        };
      }
      failures.push(`${sl.startDate}〜${sl.endDate}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const ok = res.ok && data && typeof data === "object" && Boolean((data as { ok?: boolean }).ok);
    const msg = params.resolveApiMessage(
      data,
      res.ok ? "処理が完了しました。" : `APIエラー（HTTP ${res.status}）`,
      res.status
    );
    const rec =
      data && typeof data === "object" && typeof (data as { recordCount?: unknown }).recordCount === "number"
        ? (data as { recordCount: number }).recordCount
        : 0;
    const err =
      data && typeof data === "object" && typeof (data as { errorCount?: unknown }).errorCount === "number"
        ? (data as { errorCount: number }).errorCount
        : 0;
    totalRec += rec;
    totalErr += err;
    if (!ok) {
      failures.push(`${sl.startDate}〜${sl.endDate}: ${msg}`);
    }
  }

  return {
    step: {
      key: "sma",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `SMA: ${slices.length} 区間（最大${span}日ずつ）で取得しました。`
          : `SMA: 一部失敗（${failures.length}件）。\n${failures.slice(0, 8).join("\n")}${
              failures.length > 8 ? "\n…他省略" : ""
            }`,
      recordCount: totalRec,
      errorCount: totalErr,
    },
    flowAborted: false,
  };
}

export async function runLaplaceDayChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  laplacePostUrl: string;
  prewarmPostUrl: string;
  maxDaysPerChunk: number;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
}): Promise<{ step: ChunkCollectStep; flowAborted: boolean }> {
  const chunks = eachMaxDaySliceInRange(params.rangeStart, params.rangeEnd, params.maxDaysPerChunk);
  if (chunks.length === 0) {
    return {
      step: { key: "laplace", ok: false, message: "日付範囲が不正です。", recordCount: 0, errorCount: 0 },
      flowAborted: false,
    };
  }

  await fetch(params.prewarmPostUrl, { method: "POST", signal: params.signal }).catch(() => {});

  let totalRec = 0;
  let totalErr = 0;
  const failures: string[] = [];
  let chunkIdx = 0;

  for (const ch of chunks) {
    if (params.signal.aborted) {
      params.onSetInterrupted(true);
      return {
        step: {
          key: "laplace",
          ok: failures.length === 0,
          message:
            failures.length > 0
              ? `中断。一部失敗:\n${failures.join("\n")}`
              : "ラプラス取得が中断されました。",
          recordCount: totalRec,
          errorCount: totalErr,
        },
        flowAborted: true,
      };
    }

    await fetch(params.prewarmPostUrl, { method: "POST", signal: params.signal }).catch(() => {});
    if (chunkIdx > 0) {
      // Vercel 連続起動で Chromium が閉じたり /tmp が枯渇しやすいため長めに空ける
      await new Promise((r) => setTimeout(r, 4200));
    }
    chunkIdx++;

    let res: Response;
    let data: unknown = null;
    try {
      const out = await fetchCollectPostJsonWithRetries({
        url: params.laplacePostUrl,
        body: { startDate: ch.startDate, endDate: ch.endDate },
        signal: params.signal,
      });
      res = out.res;
      data = out.data;
    } catch (e) {
      if (isAbortError(e)) {
        params.onSetInterrupted(true);
        return {
          step: {
            key: "laplace",
            ok: false,
            message:
              failures.length > 0
                ? `中断。一部失敗:\n${failures.join("\n")}`
                : "ラプラス取得が中断されました。",
            recordCount: totalRec,
            errorCount: totalErr,
          },
          flowAborted: true,
        };
      }
      failures.push(`${ch.startDate}〜${ch.endDate}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const ok = res.ok && data && typeof data === "object" && Boolean((data as { ok?: boolean }).ok);
    const msg = params.resolveApiMessage(
      data,
      res.ok ? "処理が完了しました。" : `APIエラー（HTTP ${res.status}）`,
      res.status
    );
    const rec =
      data && typeof data === "object" && typeof (data as { recordCount?: unknown }).recordCount === "number"
        ? (data as { recordCount: number }).recordCount
        : 0;
    const err =
      data && typeof data === "object" && typeof (data as { errorCount?: unknown }).errorCount === "number"
        ? (data as { errorCount: number }).errorCount
        : 0;
    totalRec += rec;
    totalErr += err;
    if (!ok) {
      failures.push(`${ch.startDate}〜${ch.endDate}: ${msg}`);
    }
  }

  return {
    step: {
      key: "laplace",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `ラプラス: ${chunks.length} 区間（最大${params.maxDaysPerChunk}日ずつ）で取得しました。`
          : `ラプラス: 一部失敗（${failures.length}件）。\n${failures.slice(0, 6).join("\n")}${
              failures.length > 6 ? "\n…他省略" : ""
            }`,
      recordCount: totalRec,
      errorCount: totalErr,
    },
    flowAborted: false,
  };
}
