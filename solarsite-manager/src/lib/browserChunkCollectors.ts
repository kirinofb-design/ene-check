import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";
import { eachCalendarMonthSliceInRange, eachMaxDaySliceInRange } from "@/lib/collectDateChunks";

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
export async function runFusionSolarByStationAndMonthChunks(params: {
  rangeStart: string;
  rangeEnd: string;
  signal: AbortSignal;
  stationPostUrl: string;
  resolveApiMessage: (data: unknown, fallback: string, httpStatus?: number) => string;
  onSetInterrupted: (v: boolean) => void;
}): Promise<{ step: ChunkCollectStep; flowAborted: boolean }> {
  const slices = eachCalendarMonthSliceInRange(params.rangeStart, params.rangeEnd);
  if (slices.length === 0) {
    return {
      step: { key: "fusion-solar", ok: false, message: "日付範囲が不正です。", recordCount: 0, errorCount: 0 },
      flowAborted: false,
    };
  }

  let totalRec = 0;
  let totalErr = 0;
  const failures: string[] = [];

  for (const station of FUSION_SOLAR_STATIONS) {
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

      let res: Response;
      try {
        res = await fetch(params.stationPostUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationNe: station.ne,
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
        failures.push(`${station.name} ${sl.startDate}〜${sl.endDate}: ${msg}`);
      }
    }
  }

  return {
    step: {
      key: "fusion-solar",
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `FusionSolar: 全${FUSION_SOLAR_STATIONS.length}発電所を、暦月に分割した ${slices.length} 区間ずつ取得しました。`
          : `FusionSolar: 一部失敗（${failures.length}件）。\n${failures.slice(0, 8).join("\n")}${
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
