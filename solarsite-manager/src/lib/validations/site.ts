import { z } from "zod";

/**
 * サイト新規登録・更新用バリデーション
 */
export const siteSchema = z.object({
  siteName: z.string().min(1, "サイト名は必須です").max(200),
  location: z.string().max(500).optional().nullable(),
  capacity: z.number().min(0, "設備容量は0以上で入力してください"),
  monitoringSystem: z.string().min(1, "監視システムは必須です").max(100),
  monitoringUrl: z.string().url("有効なURLを入力してください").max(500),
});
