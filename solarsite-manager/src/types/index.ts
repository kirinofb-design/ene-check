/**
 * API 共通レスポンス形式（Spec.md 8.1）
 */
export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * セッション拡張ユーザー（id, role を JWT に含める）
 */
export interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string;
}

/**
 * サイト（API/画面で利用）
 */
export interface SiteSummary {
  id: string;
  siteName: string;
  location: string | null;
  capacity: number;
  monitoringSystem: string;
  monitoringUrl: string;
}

/**
 * 日別発電量
 */
export interface DailyGenerationRow {
  id: string;
  siteId: string;
  date: Date;
  generation: number;
  status: string | null;
}

/**
 * アップロード履歴
 */
export interface UploadHistoryRow {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  dataFormat: string;
  recordCount: number;
  successCount: number;
  errorCount: number;
  uploadedAt: Date;
  siteId: string | null;
}
