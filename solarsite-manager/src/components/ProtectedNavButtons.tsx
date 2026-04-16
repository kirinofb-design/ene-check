"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const baseBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "12px",
  border: "1px solid #fdba74",
  backgroundColor: "#ffedd5",
  minHeight: "42px",
  padding: "0 15px",
  fontSize: "20px",
  fontWeight: 600,
  lineHeight: 1,
  color: "#9a3412",
  textDecoration: "none",
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
} as const;

const activeBtnStyle = {
  ...baseBtnStyle,
  border: "1px solid #f97316",
  backgroundColor: "#f97316",
  color: "#ffffff",
} as const;

export function ProtectedNavButtons() {
  const pathname = usePathname();
  const isReports = pathname?.startsWith("/reports");
  const isSettings = pathname?.startsWith("/settings");
  const isAdd = pathname?.startsWith("/add");

  return (
    <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pr-2 [-webkit-overflow-scrolling:touch]">
      <Link href="/add" style={isAdd ? activeBtnStyle : baseBtnStyle}>
        編集
      </Link>
      <Link href="/settings" style={isSettings ? activeBtnStyle : baseBtnStyle}>
        設定
      </Link>
      <Link href="/reports" style={isReports ? activeBtnStyle : baseBtnStyle}>
        レポート
      </Link>
    </div>
  );
}
