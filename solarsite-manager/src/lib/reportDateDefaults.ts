/** ローカルタイムゾーンの日付を YYYY-MM-DD にする */
function localYmd(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** データ収集: 開始＝当月1日、終了＝当日 */
export function defaultCollectDateRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    startDate: localYmd(y, m, 1),
    endDate: localYmd(y, m, now.getDate()),
  };
}

/** Excel 出力: 対象月 YYYY-MM（当月） */
export function defaultExcelMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
