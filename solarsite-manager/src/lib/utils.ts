/**
 * クラス名の結合（Tailwind 等で使用）
 */
export function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * 日付を YYYY-MM-DD にフォーマット
 */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 日付を日本語ロケールで表示
 */
export function formatDateJa(d: Date): string {
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * バイト数を人間が読みやすい形式に
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
