"use client";

import React, { useState } from "react";

export default function DataCollectSection() {
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-03-30");
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

  const handleCollect = async (systemName: string) => {
    setLoading(systemName);
    try {
      const endpoint = endpointBySystem[systemName] ?? "/api/collect/all";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, system: systemName }),
      });
      const data = await response.json();
      
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
            <input type="date" style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>終了日</label><br/>
            <input type="date" style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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