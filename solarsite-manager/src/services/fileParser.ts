import { read, utils } from "xlsx";
import { prisma } from "../lib/prisma";

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
  let rows: any[] = [];

  const fileName = typeof file.name === "string" ? file.name : "";
  const lower = fileName.toLowerCase();

  // CSV は xlsx.read() 経由だと文字化けしやすいので、常に UTF-8 で自前パースする
  if (lower.endsWith(".csv")) {
    const csvText = buffer.toString("utf8");
    rows = parseCsvToObjects(csvText);
  } else {
    try {
      const workbook = read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = utils.sheet_to_json(sheet, { defval: null });
    } catch {
      // xlsx が読めない場合は CSV として扱う（簡易）
      const csvText = buffer.toString("utf8");
      rows = parseCsvToObjects(csvText);
    }
  }

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
    const dateValue = pickFirstFlexible(row, dateKeys, (k) =>
      isLikelyDateKey(k)
    );
    const genValue = pickFirstFlexible(row, genKeys, (k) =>
      isLikelyGenerationKey(k)
    );

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
      status:
        (pickFirstFlexible(row, ["ステータス", "status", "状態"], () => false) as string) ??
        undefined,
      notes:
        (pickFirstFlexible(row, ["備考", "notes", "メモ", "memo"], () => false) as string) ??
        undefined,
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

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}（）［］]/g, "")
    .replace(/kwh/g, "")
    .replace(/kw/g, "");
}

function pickFirstFlexible(
  row: any,
  preferredKeys: string[],
  fallbackPredicate: (normalizedKey: string) => boolean
) {
  // 1) preferredKeys の完全一致
  for (const key of preferredKeys) {
    if (row[key] != null) return row[key];
  }

  // 2) preferredKeys の正規化一致（括弧/単位/空白揺れ対応）
  const normalizedPreferred = preferredKeys.map(normalizeKey);
  for (const rawKey of Object.keys(row)) {
    const nk = normalizeKey(rawKey);
    if (normalizedPreferred.includes(nk) && row[rawKey] != null) return row[rawKey];
  }

  // 3) それでも無い場合は、キー名から推定
  for (const rawKey of Object.keys(row)) {
    const nk = normalizeKey(rawKey);
    if (fallbackPredicate(nk) && row[rawKey] != null) return row[rawKey];
  }

  return null;
}

function isLikelyDateKey(normalizedKey: string) {
  return (
    normalizedKey.includes("日付") ||
    normalizedKey === "date" ||
    normalizedKey.includes("年月日")
  );
}

function isLikelyGenerationKey(normalizedKey: string) {
  // 発電量 / 発電電力量 / energy / generation など
  return (
    normalizedKey.includes("発電量") ||
    normalizedKey.includes("発電電力量") ||
    normalizedKey.includes("energy") ||
    normalizedKey.includes("generation") ||
    normalizedKey.includes("エネルギー")
  );
}

function parseCsvLine(line: string): string[] {
  // 簡易CSVパーサー（ダブルクォート対応）
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvToObjects(csvText: string): any[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: any[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = cols[i] ?? null;
    }
    rows.push(obj);
  }
  return rows;
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

