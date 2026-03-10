import { read, utils } from "xlsx";
import { prisma } from "@/lib/prisma";

export interface ParsedData {
  date: Date;
  generation: number;
  status?: string;
  notes?: string;
}

export interface ParseResult {
  success: boolean;
  data: ParsedData[];
  errors: string[];
  warnings: string[];
  summary: {
    totalRows: number;
    successCount: number;
    errorCount: number;
  };
}

// MVP では単純なヘッダー付き CSV / Excel を想定し、Phase 3 では
// CustomFormat で定義されたカラム候補を優先的に利用する。
export async function parseFile(
  file: File,
  siteId?: string
): Promise<ParseResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows: any[] = utils.sheet_to_json(sheet, { defval: null });

  const data: ParsedData[] = [];
  const errors: string[] = [];

  // デフォルトキー
  let dateKeys = ["日付", "date", "年月日"];
  let genKeys = ["発電量", "generation", "energy", "発電電力量"];

  // サイトまたは監視システムに紐づくカスタムフォーマットがあれば反映
  if (siteId) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      include: {
        customFormats: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const format =
      site?.customFormats[0] ??
      (site
        ? await prisma.customFormat.findFirst({
            where: {
              monitoringSystem: site.monitoringSystem,
              isActive: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : null);

    if (format) {
      try {
        const cfg = JSON.parse(format.config) as {
          dateKeys?: string[];
          generationKeys?: string[];
        };
        if (Array.isArray(cfg.dateKeys) && cfg.dateKeys.length > 0) {
          dateKeys = cfg.dateKeys;
        }
        if (Array.isArray(cfg.generationKeys) && cfg.generationKeys.length > 0) {
          genKeys = cfg.generationKeys;
        }
      } catch {
        // config が壊れていてもデフォルトキーでパースを継続
      }
    }
  }

  for (const row of rows) {
    const dateValue = pickFirst(row, dateKeys);
    const genValue = pickFirst(row, genKeys);

    if (!dateValue || genValue == null) {
      errors.push("日付または発電量が欠落している行をスキップしました。");
      continue;
    }

    const date = normalizeDate(dateValue);
    const generation = Number(genValue);

    if (!date || Number.isNaN(generation) || generation < 0) {
      errors.push("不正な日付または発電量の行をスキップしました。");
      continue;
    }

    data.push({
      date,
      generation,
      status: (row["ステータス"] as string) ?? (row["status"] as string),
      notes: (row["備考"] as string) ?? (row["notes"] as string),
    });
  }

  return {
    success: errors.length === 0,
    data,
    errors,
    warnings: [],
    summary: {
      totalRows: rows.length,
      successCount: data.length,
      errorCount: errors.length,
    },
  };
}

function pickFirst(row: any, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null) return row[key];
  }
  return null;
}

function normalizeDate(value: any): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // 簡易的な Excel シリアル値対応
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

