import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";
import { eachMaxDaySliceInRange } from "@/lib/collectDateChunks";

export type ChunkCollectStep = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

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
      await new Promise((r) => setTimeout(r, 200));
    }
    reqIndex++;

    let res: Response;
    try {
      res = await fetch(params.windowPostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: sl.startDate,
          endDate: sl.endDate,
        }),
        signal: params.signal,
      });
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
      throw e;
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => "");
      data = { message: text || null };
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

    if (chunkIdx > 0) {
      await new Promise((r) => setTimeout(r, 350));
    }
    chunkIdx++;

    let res: Response;
    try {
      res = await fetch(params.laplacePostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: ch.startDate,
          endDate: ch.endDate,
        }),
        signal: params.signal,
      });
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
      throw e;
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => "");
      data = { message: text || null };
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
