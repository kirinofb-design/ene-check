"use client";

import React, { useEffect, useState } from "react";
import { defaultExcelMonth } from "@/lib/reportDateDefaults";

export default function ExcelExportSection() {
  const [targetMonth, setTargetMonth] = useState(() => defaultExcelMonth());

  useEffect(() => {
    setTargetMonth(defaultExcelMonth());
  }, []);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/reports/export-excel?month=${encodeURIComponent(targetMonth)}`);
      if (!res.ok) {
        let message = `Excel の生成に失敗しました。（HTTP ${res.status}）`;
        try {
          const data = (await res.json()) as {
            error?: { code?: string; message?: string };
            message?: string;
          };
          if (typeof data?.error?.message === "string" && data.error.message.trim()) {
            message = data.error.message;
          } else if (typeof data?.message === "string" && data.message.trim()) {
            message = data.message;
          }
        } catch {
          const text = await res.text().catch(() => "");
          if (text.trim()) message = text;
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const apiNotice = res.headers.get("X-Excel-Notice");
      if (apiNotice && apiNotice.trim()) {
        alert(apiNotice);
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileNameMatch = /filename="?([^"]+)"?/.exec(disposition);
      const fileName = fileNameMatch?.[1] ?? `generation_${targetMonth}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Excel ダウンロードに失敗しました。";
      alert(message);
    } finally {
      setDownloading(false);
    }
  }

  // カード全体のスタイル
  const cardStyle = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    padding: '24px',
    width: '100%',
    flex: 1,
    minHeight: 0,
    margin: '0',
    fontFamily: 'sans-serif',
    textAlign: 'left' as const,
    display: 'flex',
    flexDirection: 'column' as const,
  };

  const inputStyle = {
    width: '180px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '14px',
    marginTop: '8px',
    outline: 'none',
  };

  const excelBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '45px',
    padding: '0 24px',
    backgroundColor: '#16a34a', // Excelカラーの緑
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '24px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    opacity: downloading ? 0.7 : 1,
  };

  return (
    <div style={{ textAlign: 'left' }}>
      <div style={cardStyle}>
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: '0' }}>
            データ出力
          </h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', lineHeight: '1.6' }}>
            対象月を選択してダウンロードしてください。<br/>
            左の「データ取得」でDBに保存された、全サイトの日別発電データを1枚のExcelシートにまとめて出力します。
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' }}>出力対象月</label><br/>
          <input 
            type="month" 
            style={inputStyle} 
            value={targetMonth} 
            onChange={(e) => setTargetMonth(e.target.value)} 
          />
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '4px', marginTop: 'auto' }}>
          <button
            style={excelBtnStyle}
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>📊</span>
            {downloading ? "Excel を生成中..." : "Excel をダウンロード"}
          </button>
        </div>
      </div>
    </div>
  );
}
