"use client";

import React, { useEffect, useRef, useState } from "react";
import { defaultCollectDateRange } from "@/lib/reportDateDefaults";
import {
  fetchCollectPostJsonWithRetries,
  runFusionSolarDayWindowChunks,
  runLaplaceDayChunks,
  runSmaDayChunks,
} from "@/lib/browserChunkCollectors";

const FUSION_SOLAR_WINDOW_POST_URL = "/api/collect/fusion-solar/window";
const COLLECT_PREWARM_URL = "/api/collect/prewarm";
/** ラプラス・SMA いずれも「1リクエスト短め」にして Hobby の約10秒制限を避ける */
const LAPLACE_DAY_CHUNK = 5;
const SMA_DAY_CHUNK = 2;

export default function DataCollectSection() {
  const [range, setRange] = useState(() => defaultCollectDateRange());

  useEffect(() => {
    setRange(defaultCollectDateRange());
  }, []);
  const [loading, setLoading] = useState<string | null>(null);
  const [allLocked, setAllLocked] = useState(false);
  const [runningKind, setRunningKind] = useState<string | null>(null);
  const [allCancelRequested, setAllCancelRequested] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const allCollectAbortRef = useRef<AbortController | null>(null);

  const endpointBySystem: Record<string, string> = {
    "eco-megane": "/api/collect/eco-megane",
    FusionSolar: "/api/collect/fusion-solar",
    SMA: "/api/collect/sma",
    ラプラス: "/api/collect/laplace",
    "池新田・本社": "/api/collect/solar-monitor-sf",
    須山: "/api/collect/solar-monitor-se",
  };

  const collectorStepLabel: Record<string, string> = {
    "eco-megane": "エコめがね",
    "fusion-solar": "FusionSolar",
    sma: "SMA",
    laplace: "ラプラス",
    "solar-monitor-sf": "池新田・本社（Solar Monitor）",
    "solar-monitor-se": "須山（Solar Monitor）",
  };

  /** 一括APIの step.key → 画面上の個別取得ボタン表記（handleCollect に渡す systemName と一致） */
  const individualButtonByStepKey: Record<string, string> = {
    "eco-megane": "eco-megane",
    "fusion-solar": "FusionSolar",
    sma: "SMA",
    laplace: "ラプラス",
    "solar-monitor-sf": "池新田・本社",
    "solar-monitor-se": "須山",
  };

  type CollectStep = {
    key: string;
    ok: boolean;
    message: string;
    recordCount: number;
    errorCount: number;
  };

  const formatAllCollectResult = (data: {
    message?: string;
    steps?: CollectStep[];
  }): string => {
    const head = data.message ?? "一括取得が終了しました。";
    const raw = Array.isArray(data.steps) ? data.steps : [];
    if (raw.length === 0) return head;
    // 失敗を先に表示（スクロールせず原因が分かるようにする）
    const steps = [...raw].sort((a, b) => Number(a.ok) - Number(b.ok));
    const lines = steps.map((s) => {
      const name = collectorStepLabel[s.key] ?? s.key;
      const mark = s.ok ? "成功" : "失敗";
      return `［${mark}］ ${name}\n  ${s.message}\n  （保存 ${s.recordCount} 件 / スキップ ${s.errorCount} 件）`;
    });
    const failed = steps.filter((s) => !s.ok);
    const failedGuide =
      failed.length > 0
        ? `\n\n──────── 失敗したシステムの再実行 ────────\n以下は「個別システム取得」の行で、上記と同じ開始日・終了日のまま、該当ボタンを押して再実行してください。\n\n${failed
          .map((s) => {
            const btn = individualButtonByStepKey[s.key] ?? s.key;
            const label = collectorStepLabel[s.key] ?? s.key;
            return `・ ${label} … ボタン「${btn}」`;
          })
          .join("\n")}\n\n成功したシステムのデータはすでにDBに保存されています。Excelは右の「Excel をダウンロード」で、その時点のDBを出力します。`
        : "\n\nすべてのシステムが成功しました。Excelは右の「Excel をダウンロード」で出力できます。";
    return `${head}\n\n──────── システム別（失敗を上に表示）────────\n\n${lines.join("\n\n")}${failedGuide}`;
  };

  const resolveApiMessage = (data: unknown, fallback: string, httpStatus?: number): string => {
    if (httpStatus === 504) {
      return "サーバーが応答するまでに時間がかかりすぎました（ゲートウェイタイムアウト）。全データ一括取得はサーバが全システムを順に処理します。Vercel 本番では COLLECT_FANOUT_SECRET を設定すると内部でシステム別 API に分かれやすくなります。期間を短くするか、実行時間上限の延長も検討してください。個別ボタンの SMA・FusionSolar・ラプラスは引き続きブラウザから分割呼び出しします。";
    }
    if (data && typeof data === "object") {
      const d = data as {
        message?: unknown;
        error?: { message?: unknown };
      };
      if (typeof d.message === "string" && d.message.trim().length > 0) {
        return d.message;
      }
      if (typeof d.error?.message === "string" && d.error.message.trim().length > 0) {
        return d.error.message;
      }
    }
    return fallback;
  };

  const handleCollect = async (systemName: string) => {
    if (systemName === "all" && allLocked) {
      alert(lockMessage ?? "実行中（排他ロック中）です。完了してから再実行してください。");
      return;
    }
    setLoading(systemName);
    try {
      if (systemName === "all") {
        const signal = (() => {
          const c = new AbortController();
          allCollectAbortRef.current = c;
          return c.signal;
        })();
        let response: Response;
        try {
          response = await fetch("/api/collect/all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startDate: range.startDate,
              endDate: range.endDate,
            }),
            signal,
          });
        } catch (e) {
          if (
            (e instanceof DOMException && e.name === "AbortError") ||
            (e instanceof Error && e.name === "AbortError")
          ) {
            alert(
              "一括取得を中断しました（通信を切断しました）。サーバ側は「実行取消」で停止を依頼済みの場合があります。"
            );
          } else {
            alert(`allの通信に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
          }
          return;
        } finally {
          allCollectAbortRef.current = null;
        }

        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          data = { message: "レスポンスの解析に失敗しました。" };
        }

        let mirrorAppend = "";
        if (data && typeof data === "object") {
          const ms = (data as { mirrorSync?: unknown }).mirrorSync;
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

        if (data && typeof data === "object" && Array.isArray((data as { steps?: unknown }).steps)) {
          alert(formatAllCollectResult(data as { message?: string; steps?: CollectStep[] }) + mirrorAppend);
        } else {
          alert(
            `allのエラー: ${resolveApiMessage(
              data,
              `APIエラーが発生しました（HTTP ${response.status}）`,
              response.status
            )}`
          );
        }
        return;
      }

      if (systemName === "SMA") {
        const noop = () => {};
        const { step } = await runSmaDayChunks({
          rangeStart: range.startDate,
          rangeEnd: range.endDate,
          signal: new AbortController().signal,
          smaPostUrl: endpointBySystem.SMA,
          resolveApiMessage,
          onSetInterrupted: noop,
          maxDaysPerChunk: SMA_DAY_CHUNK,
        });
        const detail = `（保存 ${step.recordCount} 件 / スキップ ${step.errorCount} 件）`;
        if (step.ok) {
          alert(`SMA: ${step.message}\n${detail}`);
        } else {
          alert(`SMAのエラー:\n${step.message}\n${detail}`);
        }
        return;
      }

      if (systemName === "FusionSolar") {
        const noop = () => {};
        const { step } = await runFusionSolarDayWindowChunks({
          rangeStart: range.startDate,
          rangeEnd: range.endDate,
          signal: new AbortController().signal,
          windowPostUrl: FUSION_SOLAR_WINDOW_POST_URL,
          resolveApiMessage,
          onSetInterrupted: noop,
        });
        const detail = `（保存 ${step.recordCount} 件 / スキップ ${step.errorCount} 件）`;
        if (step.ok) {
          alert(`FusionSolar: ${step.message}\n${detail}`);
        } else {
          alert(`FusionSolarのエラー:\n${step.message}\n${detail}`);
        }
        return;
      }

      if (systemName === "ラプラス") {
        const noop = () => {};
        const { step } = await runLaplaceDayChunks({
          rangeStart: range.startDate,
          rangeEnd: range.endDate,
          signal: new AbortController().signal,
          laplacePostUrl: endpointBySystem.ラプラス,
          prewarmPostUrl: COLLECT_PREWARM_URL,
          maxDaysPerChunk: LAPLACE_DAY_CHUNK,
          resolveApiMessage,
          onSetInterrupted: noop,
        });
        const detail = `（保存 ${step.recordCount} 件 / スキップ ${step.errorCount} 件）`;
        if (step.ok) {
          alert(`ラプラス: ${step.message}\n${detail}`);
        } else {
          alert(`ラプラスのエラー:\n${step.message}\n${detail}`);
        }
        return;
      }

      const endpoint = endpointBySystem[systemName];
      if (!endpoint) {
        alert(`${systemName}の収集先が未定義です。`);
        return;
      }
      const indivSignal = new AbortController().signal;
      let response: Response;
      let data: unknown = null;
      try {
        const out = await fetchCollectPostJsonWithRetries({
          url: endpoint,
          body: { startDate: range.startDate, endDate: range.endDate, system: systemName },
          signal: indivSignal,
          maxAttempts: 4,
        });
        response = out.res;
        data = out.data;
      } catch {
        alert(`${systemName}の通信に失敗しました`);
        return;
      }

      const message = resolveApiMessage(
        data,
        response.ok ? "処理が完了しました。" : `APIエラーが発生しました（HTTP ${response.status}）`,
        response.status
      );
      if (data && typeof data === "object" && (data as { ok?: boolean }).ok) {
        alert(`${systemName}: ${message}`);
      } else {
        alert(`${systemName}のエラー: ${message}`);
      }
    } catch (error) {
      alert(`${systemName}の通信に失敗しました`);
    } finally {
      setLoading(null);
    }
  };

  const handleCancelAll = async () => {
    if (loading === "all" && allCollectAbortRef.current) {
      allCollectAbortRef.current.abort();
      try {
        await fetch("/api/collect/all/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        /* 取消通知はベストエフォート */
      }
      return;
    }
    try {
      const res = await fetch("/api/collect/all/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      const accepted =
        data && typeof data === "object" && Boolean((data as { accepted?: boolean }).accepted);
      if (accepted) {
        // 次回ポーリング待ちにせず、即時に取消受付表示へ切り替える
        setAllCancelRequested(true);
        setLockMessage("実行取消を受け付けました。進行中の処理の区切りで停止します。");
      }
      const msg = resolveApiMessage(
        data,
        res.ok ? "実行取消を受け付けました。" : `APIエラーが発生しました（HTTP ${res.status}）`,
        res.status
      );
      alert(msg);
    } catch {
      alert("実行取消の通信に失敗しました");
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const RUNNING_POLL_MS = 3000;
    const IDLE_POLL_MS = 10000;

    const scheduleNext = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshLockState();
      }, ms);
    };

    const refreshLockState = async () => {
      try {
        const res = await fetch("/api/collect/status", { cache: "no-store" });
        const data = (await res.json()) as {
          allRunning?: boolean;
          singleRunning?: boolean;
          runningKind?: string | null;
          allCancelRequested?: boolean;
          message?: string | null;
          allProgress?: {
            totalSteps?: number;
            completedSteps?: number;
            currentStepKey?: string | null;
          } | null;
        };
        if (cancelled) return;
        const running = !!data?.allRunning || !!data?.singleRunning;
        const cancelRequested = !!data?.allCancelRequested;
        setAllLocked(running);
        setRunningKind(typeof data?.runningKind === "string" ? data.runningKind : null);
        setAllCancelRequested(cancelRequested);
        const totalSteps = Number(data?.allProgress?.totalSteps ?? 0);
        const completedSteps = Number(data?.allProgress?.completedSteps ?? 0);
        const currentStepKey =
          typeof data?.allProgress?.currentStepKey === "string" ? data.allProgress.currentStepKey : null;
        const currentStepLabel = currentStepKey ? collectorStepLabel[currentStepKey] ?? currentStepKey : null;
        const progressSuffix =
          running && totalSteps > 0
            ? `（進捗 ${Math.min(completedSteps, totalSteps)}/${totalSteps}${
                currentStepLabel ? `・実行中: ${currentStepLabel}` : ""
              }）`
            : "";
        setLockMessage(
          running
            ? data?.message ?? "実行中（排他ロック中）です。完了してから再実行してください。"
            : null
        );
        if (running && progressSuffix) {
          setLockMessage((prev) => `${prev ?? "実行中です。"}${progressSuffix}`);
        }
        scheduleNext(running ? RUNNING_POLL_MS : IDLE_POLL_MS);
      } catch {
        if (cancelled) return;
        // 通信エラー時は待機時と同じ間隔で再試行する
        scheduleNext(IDLE_POLL_MS);
      }
    };
    void refreshLockState();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // スタイル定義
  const cardStyle = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    padding: '24px',
    width: '100%',
    height: '100%',
    margin: '0',
    fontFamily: 'sans-serif',
    textAlign: 'left' as const,
    display: 'flex',
    flexDirection: 'column' as const,
  };

  const inputStyle = {
    width: '160px', // 入力欄をよりコンパクトに
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '14px',
    marginTop: '6px',
    outline: 'none',
  };

  const systemBtnStyle = (isLoading: boolean) => ({
    padding: '4px 8px',
    backgroundColor: isLoading ? '#e2e8f0' : '#e0f2fe',
    border: '1px solid #bae6fd',
    borderRadius: '6px',
    fontSize: '11px',
    color: isLoading ? '#94a3b8' : '#0c4a6e',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    transition: 'all 0.1s',
    whiteSpace: 'nowrap' as const,
  });

  const mainBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'auto', // 横幅を広げすぎない
    padding: '12px 24px',
    backgroundColor: (loading === 'all' || allLocked) ? '#94a3b8' : '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: (loading === 'all' || allLocked) ? 'not-allowed' : 'pointer',
    marginTop: '24px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  };
  const cancelBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'auto',
    padding: '12px 24px',
    backgroundColor: allCancelRequested ? '#9ca3af' : '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: allCancelRequested ? 'not-allowed' : 'pointer',
    marginTop: '24px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  };

  return (
    <div style={{ textAlign: 'left', height: '100%' }}>
      <div style={cardStyle}>
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: '0' }}>データ取得</h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>同期期間を指定して、データを取得します。</p>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>開始日</label><br/>
            <input
              type="date"
              style={inputStyle}
              value={range.startDate}
              onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>終了日</label><br/>
            <input
              type="date"
              style={inputStyle}
              value={range.endDate}
              onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px' }}>個別システム取得</label>
          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '4px' }}>
            {["eco-megane", "FusionSolar", "SMA", "ラプラス", "池新田・本社", "須山"].map((name) => (
              <button 
                key={name} 
                style={systemBtnStyle(loading === name)}
                onClick={() => handleCollect(name)}
                disabled={!!loading}
              >
                {loading === name ? "取得中..." : name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '4px', marginTop: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button 
              style={mainBtnStyle}
              onClick={() => handleCollect('all')}
              disabled={!!loading || allLocked}
            >
              {loading === 'all'
                ? "取得中..."
                : allLocked
                  ? runningKind === "all"
                    ? "実行中（排他ロック中）"
                    : "他処理実行中（排他ロック中）"
                  : "全データ一括取得"}
            </button>
            <button
              style={cancelBtnStyle}
              onClick={() => void handleCancelAll()}
              disabled={(!allLocked && loading !== "all") || allCancelRequested}
              title={!allLocked && loading !== "all" ? "実行中のみ取消できます" : undefined}
            >
              {allCancelRequested ? "取消受付済み" : "実行取消"}
            </button>
          </div>
          {allLocked && lockMessage ? (
            <p style={{ fontSize: '11px', color: '#334155', marginTop: '6px', lineHeight: 1.5, marginBottom: 0 }}>
              {lockMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}