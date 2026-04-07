"use client";

import React, { useEffect, useState } from "react";
import { defaultCollectDateRange } from "@/lib/reportDateDefaults";

export default function DataCollectSection() {
  const [range, setRange] = useState(() => defaultCollectDateRange());

  useEffect(() => {
    setRange(defaultCollectDateRange());
  }, []);
  const [loading, setLoading] = useState<string | null>(null);
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

  const handleCollect = async (systemName: string) => {
    setLoading(systemName);
    try {
      const endpoint = endpointBySystem[systemName] ?? "/api/collect/all";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          system: systemName,
        }),
      });
      const data = await response.json();

      if (systemName === "all" && Array.isArray(data.steps)) {
        alert(formatAllCollectResult(data));
        return;
      }

      if (data.ok) {
        alert(`${systemName}: ${data.message}`);
      } else {
        alert(`${systemName}のエラー: ${data.message}`);
      }
    } catch (error) {
      alert(`${systemName}の通信に失敗しました`);
    } finally {
      setLoading(null);
    }
  };

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
    backgroundColor: loading === 'all' ? '#94a3b8' : '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: loading === 'all' ? 'not-allowed' : 'pointer',
    marginTop: '24px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  };

  return (
    <div style={{ textAlign: 'left', height: '100%' }}>
      <div style={cardStyle}>
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: '0' }}>データ収集</h2>
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

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
          <button 
            style={mainBtnStyle}
            onClick={() => handleCollect('all')}
            disabled={!!loading}
          >
            {loading === 'all' ? "取得中..." : "全データ一括取得"}
          </button>
        </div>
      </div>
    </div>
  );
}