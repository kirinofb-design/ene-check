import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";
import { eachMaxDaySliceInRange } from "@/lib/collectDateChunks";

const TRANSIENT_HTTP = new Set([408, 429, 502, 503, 504, 524]);

function looksLikeTransientFailureMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("504") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("500") ||
    m.includes("gateway") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("econnreset") ||
    m.includes("socket hang up") ||
    m.includes("fetch failed") ||
    m.includes("database server") ||
    m.includes("p1001") ||
    m.includes("too many requests") ||
    m.includes("rate limit") ||
    m.includes("browser has been closed") ||
    m.includes("context or browser has been closed") ||
    m.includes("target page, context or browser") ||
    m.includes("execution context was destroyed") ||
    m.includes("browsercontext.newpage") ||
    m.includes("err_insufficient_resources") ||
    m.includes("insufficient_resources") ||
    m.includes("detached frame") ||
    /ログインid入力欄が見つかりません/i.test(message) ||
    /サーバ[ーー]?エラー/.test(message)
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
      const extra =
        looksLikeTransientFailureMessage(msg) &&
        (msg.toLowerCase().includes("browser") || msg.toLowerCase().includes("context"))
          ? 2500
          : 0;
      await sleep(1500 * attempt + extra, params.signal);
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

export type CollectChunkProgress = {
  chunkIndex: number;
  chunkTotal: number;
  label: string;
};

type DateSlice = { startDate: string; endDate: string };

function dateSliceLabel(sl: DateSlice): string {
  return sl.startDate === sl.endDate ? sl.startDate : `${sl.startDate}〜${sl.endDate}`;
}

type SliceCollectOutcome = {
  ok: boolean;
  msg: string;
  rec: number;
  err: number;
  label: string;
};

/** 失敗した日付チャンクを1パス再試行し、成功した日の failures を除去する */
async function retryFailedDateSlices(params: {
  failedSlices: DateSlice[];
  failures: string[];
  signal: AbortSignal;
  runSlice: (sl: DateSlice) => Promise<SliceCollectOutcome>;
  beforeRetry?: () => Promise<void>;
  betweenMs?: number;
}): Promise<{ extraRec: number; extraErr: number }> {
  if (params.failedSlices.length === 0 || params.signal.aborted) {
    return { extraRec: 0, extraErr: 0 };
  }
  await params.beforeRetry?.();
  await new Promise((r) => setTimeout(r, 6000));
  let extraRec = 0;
  let extraErr = 0;
  const recovered = new Set<string>();
  for (const sl of params.failedSlices) {
    if (params.signal.aborted) break;
    await new Promise((r) => setTimeout(r, params.betweenMs ?? 1500));
    try {
      const result = await params.runSlice(sl);
      extraRec += result.rec;
      extraErr += result.err;
      if (result.ok) recovered.add(result.label);
    } catch {
      // 初回 failures を維持
    }
  }
  if (recovered.size > 0) {
    for (let i = params.failures.length - 1; i >= 0; i--) {
      const line = params.failures[i] ?? "";
      for (const label of recovered) {
        if (line.startsWith(`${label}:`) || line.startsWith(`${label}〜`)) {
          params.failures.splice(i, 1);
          break;
        }
      }
    }
  }
  return { extraRec, extraErr };
}

/** ブラウザからのみ import すること（fetch を使用） */
export async function runFusionSolarDayWindowChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  windowPostUrl: string;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
  onChunkProgress?: (p: CollectChunkProgress) => void;
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
  const failedSlices: DateSlice[] = [];
  let reqIndex = 0;

  const runOneFusionSlice = async (sl: DateSlice): Promise<SliceCollectOutcome> => {
    const out = await fetchCollectPostJsonWithRetries({
      url: params.windowPostUrl,
      body: { startDate: sl.startDate, endDate: sl.endDate },
      signal: params.signal,
      maxAttempts: 5,
    });
    const ok = Boolean(
      out.res.ok &&
        out.data &&
        typeof out.data === "object" &&
        (out.data as { ok?: boolean }).ok === true
    );
    const msg = params.resolveApiMessage(
      out.data,
      out.res.ok ? "処理が完了しました。" : `APIエラー（HTTP ${out.res.status}）`,
      out.res.status
    );
    const rec =
      out.data && typeof out.data === "object" && typeof (out.data as { recordCount?: unknown }).recordCount === "number"
        ? (out.data as { recordCount: number }).recordCount
        : 0;
    const err =
      out.data && typeof out.data === "object" && typeof (out.data as { errorCount?: unknown }).errorCount === "number"
        ? (out.data as { errorCount: number }).errorCount
        : 0;
    return { ok, msg, rec, err, label: sl.startDate };
  };

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
      await new Promise((r) => setTimeout(r, 1100));
    }
    reqIndex++;
    params.onChunkProgress?.({
      chunkIndex: reqIndex,
      chunkTotal: slices.length,
      label: dateSliceLabel(sl),
    });

    try {
      const result = await runOneFusionSlice(sl);
      totalRec += result.rec;
      totalErr += result.err;
      if (!result.ok) {
        failures.push(`${sl.startDate}: ${result.msg}`);
        failedSlices.push(sl);
      }
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
      failedSlices.push(sl);
    }
  }

  const retryTotals = await retryFailedDateSlices({
    failedSlices,
    failures,
    signal: params.signal,
    runSlice: runOneFusionSlice,
  });
  totalRec += retryTotals.extraRec;
  totalErr += retryTotals.extraErr;

  return {
    step: {
      key: "fusion-solar",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `FusionSolar: 全日を1日単位（${slices.length}回）に分け、各回で全${FUSION_SOLAR_STATIONS.length}発電所を取得しました。`
          : `FusionSolar: 一部失敗（${failures.length}件）。欠損日は FusionSolar ボタンで該当日を再取得してください。\n${failures.slice(0, 10).join("\n")}${
              failures.length > 10 ? "\n…他省略" : ""
            }`,
      recordCount: totalRec,
      errorCount: totalErr,
    },
    flowAborted: false,
  };
}

/** SMA は1日単位（Vercel では autoLogin を避け Cookie のみのため、1リクエストを軽く保つ） */
const SMA_DAYS_PER_CHUNK_DEFAULT = 1;

export async function runSmaDayChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  smaPostUrl: string;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
  maxDaysPerChunk?: number;
  onChunkProgress?: (p: CollectChunkProgress) => void;
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
      await new Promise((r) => setTimeout(r, 4500));
    }
    reqIndex++;
    params.onChunkProgress?.({
      chunkIndex: reqIndex,
      chunkTotal: slices.length,
      label: `${sl.startDate}〜${sl.endDate}`,
    });

    let res: Response;
    let data: unknown = null;
    try {
      const out = await fetchCollectPostJsonWithRetries({
        url: params.smaPostUrl,
        body: { startDate: sl.startDate, endDate: sl.endDate },
        signal: params.signal,
        maxAttempts: 5,
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
  onChunkProgress?: (p: CollectChunkProgress) => void;
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
  const failedSlices: DateSlice[] = [];
  let chunkIdx = 0;

  const runOneLaplaceSlice = async (ch: DateSlice): Promise<SliceCollectOutcome> => {
    const out = await fetchCollectPostJsonWithRetries({
      url: params.laplacePostUrl,
      body: { startDate: ch.startDate, endDate: ch.endDate },
      signal: params.signal,
      maxAttempts: 5,
    });
    const ok = Boolean(
      out.res.ok &&
        out.data &&
        typeof out.data === "object" &&
        (out.data as { ok?: boolean }).ok === true
    );
    const msg = params.resolveApiMessage(
      out.data,
      out.res.ok ? "処理が完了しました。" : `APIエラー（HTTP ${out.res.status}）`,
      out.res.status
    );
    const rec =
      out.data && typeof out.data === "object" && typeof (out.data as { recordCount?: unknown }).recordCount === "number"
        ? (out.data as { recordCount: number }).recordCount
        : 0;
    const err =
      out.data && typeof out.data === "object" && typeof (out.data as { errorCount?: unknown }).errorCount === "number"
        ? (out.data as { errorCount: number }).errorCount
        : 0;
    return { ok, msg, rec, err, label: dateSliceLabel(ch) };
  };

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
      await new Promise((r) => setTimeout(r, 8000));
    }
    chunkIdx++;
    params.onChunkProgress?.({
      chunkIndex: chunkIdx,
      chunkTotal: chunks.length,
      label: dateSliceLabel(ch),
    });

    try {
      const result = await runOneLaplaceSlice(ch);
      totalRec += result.rec;
      totalErr += result.err;
      if (!result.ok) {
        failures.push(`${dateSliceLabel(ch)}: ${result.msg}`);
        failedSlices.push(ch);
      }
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
      failures.push(`${dateSliceLabel(ch)}: ${e instanceof Error ? e.message : String(e)}`);
      failedSlices.push(ch);
    }
  }

  const retryTotals = await retryFailedDateSlices({
    failedSlices,
    failures,
    signal: params.signal,
    beforeRetry: async () => {
      await fetch(params.prewarmPostUrl, { method: "POST", signal: params.signal }).catch(() => {});
    },
    betweenMs: 3000,
    runSlice: runOneLaplaceSlice,
  });
  totalRec += retryTotals.extraRec;
  totalErr += retryTotals.extraErr;

  return {
    step: {
      key: "laplace",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `ラプラス: ${chunks.length} 区間（最大${params.maxDaysPerChunk}日ずつ）で取得しました。`
          : `ラプラス: 一部失敗（${failures.length}件）。欠損日はラプラスボタンで該当区間を再取得してください。\n${failures.slice(0, 6).join("\n")}${
              failures.length > 6 ? "\n…他省略" : ""
            }`,
      recordCount: totalRec,
      errorCount: totalErr,
    },
    flowAborted: false,
  };
}
