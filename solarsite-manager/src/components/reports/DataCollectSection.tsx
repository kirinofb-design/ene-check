"use client";

import React, { useEffect, useState } from "react";
import { defaultCollectDateRange } from "@/lib/reportDateDefaults";

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
  const endpointBySystem: Record<string, string> = {
    "eco-megane": "/api/collect/eco-megane",
    FusionSolar: "/api/collect/fusion-solar",
    SMA: "/api/collect/sma",
    ラプラス: "/api/collect/laplace",
    "池新田・本社": "/api/collect/solar-monitor-sf",
    須山: "/api/collect/solar-monitor-se",
    all: "/api/collect/all",
  };

  const collectorStepLabel: Record<string, string> = {
    "eco-megane": "エコめがね",
    "fusion-solar": "FusionSolar",
    sma: "SMA",
    laplace: "ラプラス",
    "solar-monitor-sf": "池新田・本社（Solar Monitor）",
    "solar-monitor-se": "須山（Solar Monitor）",
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
    return `${head}\n\n──────── システム別（失敗を上に表示）────────\n\n${lines.join("\n\n")}`;
  };

  const resolveApiMessage = (data: unknown, fallback: string, httpStatus?: number): string => {
    if (httpStatus === 504) {
      return "サーバーが応答するまでに時間がかかりすぎました（ゲートウェイタイムアウト）。FusionSolarなど重い処理は発電所×月のため時間がかかります。開始日・終了日を短く分けて試すか、混雑していない時間帯に再実行してください。";
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
  const isFusionSolarCappedMessage = (message: string): boolean =>
    message.includes("実行時間の上限") || message.includes("ここまでにしました");

  const handleCollect = async (systemName: string) => {
    if (systemName === "all" && allLocked) {
      alert(lockMessage ?? "実行中（排他ロック中）です。完了してから再実行してください。");
      return;
    }
    setLoading(systemName);
    try {
      const endpoint = endpointBySystem[systemName] ?? "/api/collect/all";
      const maxFusionAttempts = systemName === "FusionSolar" ? 4 : 1;
      let attempt = 0;
      let totalRecordCount = 0;
      let totalErrorCount = 0;
      let response: Response | null = null;
      let data: unknown = null;
      while (attempt < maxFusionAttempts) {
        attempt++;
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: range.startDate,
            endDate: range.endDate,
            system: systemName,
          }),
        });
        try {
          data = await response.json();
        } catch {
          const text = await response.text().catch(() => "");
          data = { message: text || null };
        }
        if (systemName !== "FusionSolar") break;
        const oneRecordCount =
          data && typeof data === "object" && typeof (data as { recordCount?: unknown }).recordCount === "number"
            ? (data as { recordCount: number }).recordCount
            : 0;
        const oneErrorCount =
          data && typeof data === "object" && typeof (data as { errorCount?: unknown }).errorCount === "number"
            ? (data as { errorCount: number }).errorCount
            : 0;
        totalRecordCount += oneRecordCount;
        totalErrorCount += oneErrorCount;
        const msg = resolveApiMessage(
          data,
          response.ok ? "処理が完了しました。" : `APIエラーが発生しました（HTTP ${response.status}）`,
          response.status
        );
        const canContinue =
          response.ok &&
          data &&
          typeof data === "object" &&
          Boolean((data as { ok?: boolean }).ok) &&
          isFusionSolarCappedMessage(msg);
        if (!canContinue) break;
      }
      if (!response) {
        alert(`${systemName}の通信に失敗しました`);
        return;
      }

      if (
        systemName === "all" &&
        data &&
        typeof data === "object" &&
        Array.isArray((data as { steps?: unknown[] }).steps)
      ) {
        alert(formatAllCollectResult(data as { message?: string; steps?: CollectStep[] }));
        return;
      }

      const message = resolveApiMessage(
        data,
        response.ok ? "処理が完了しました。" : `APIエラーが発生しました（HTTP ${response.status}）`,
        response.status
      );
      if (data && typeof data === "object" && (data as { ok?: boolean }).ok) {
        if (systemName === "FusionSolar" && maxFusionAttempts > 1 && attempt > 1) {
          alert(
            `${systemName}: ${message}\n（自動再実行 ${attempt} 回 / 累計 保存 ${totalRecordCount} 件・スキップ ${totalErrorCount} 件）`
          );
        } else {
          alert(`${systemName}: ${message}`);
        }
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
        };
        if (cancelled) return;
        const running = !!data?.allRunning || !!data?.singleRunning;
        const cancelRequested = !!data?.allCancelRequested;
        setAllLocked(running);
        setRunningKind(typeof data?.runningKind === "string" ? data.runningKind : null);
        setAllCancelRequested(cancelRequested);
        setLockMessage(
          running
            ? data?.message ?? "実行中（排他ロック中）です。完了してから再実行してください。"
            : null
        );
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
              onClick={handleCancelAll}
              disabled={!allLocked || allCancelRequested}
              title={!allLocked ? "実行中のみ取消できます" : undefined}
            >
              {allCancelRequested ? "取消受付済み" : "実行取消"}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#64748b', marginTop: '10px', lineHeight: 1.5, marginBottom: 0 }}>
            6システムを同時に実行します（完了までの時間は、もっとも遅い処理にほぼ一致します）。
          </p>
        </div>
      </div>
    </div>
  );
}