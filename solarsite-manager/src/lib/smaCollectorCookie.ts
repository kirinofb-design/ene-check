import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { throwIfAllCollectCancelled } from "@/lib/collectCancel";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const SMA_COOKIE_MISSING_ERROR = "SMA Cookie が未登録または期限切れです。/settings から Cookie を登録してください。";
const SUNNY_PORTAL_SILENT_LOGIN_URL =
  "https://login.sma.energy/auth/realms/SMA/protocol/openid-connect/auth?client_id=SunnyPortalClassic&client_secret=baa6d5fe-f905-4fb2-bc8e-8f218acc2835&prompt=none&redirect_uri=https%3A%2F%2Fwww.sunnyportal.com%2FTemplates%2FStart.aspx%3FSilentLogin%3Dtrue&response_type=code&ui_locales=ja";
function isDebugTraceEnabled(): boolean {
  // 開発時はデフォルトON（原因調査を優先）。明示的に 0 で無効化できる。
  if (process.env.SMA_DEBUG_TRACE === "0") return false;
  if (process.env.SMA_DEBUG_TRACE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

function isDebugHeadfulEnabled(): boolean {
  // 開発時はデフォルトON（遷移を目視できるようにする）。明示的に 0 で無効化できる。
  if (process.env.SMA_DEBUG_HEADFUL === "0") return false;
  if (process.env.SMA_DEBUG_HEADFUL === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/** headful/trace 無効時は固定スリープを短くし、一括取得の所要時間を抑える（SMA_FAST_UI=0 で無効化） */
function isSmaFastCollectMode(): boolean {
  if (process.env.SMA_FAST_UI === "0") return false;
  if (process.env.SMA_FAST_UI === "1") return true;
  return !isDebugTraceEnabled() && !isDebugHeadfulEnabled();
}

async function smaDelay(msDebug: number, msFast: number): Promise<void> {
  const ms = isSmaFastCollectMode() ? msFast : msDebug;
  await new Promise((r) => setTimeout(r, ms));
}

const SMA_STATIONS = [
  {
    displayName: "フジ物産牧之原太陽光発電設備",
    siteName: "坂口（高圧）",
    plantId: "4491962d-9b59-43c7-8124-c499a199b0c9",
  },
  {
    displayName: "フジ物産白羽高圧発電所",
    siteName: "大塚（高圧）",
    plantId: "381af69d-4653-49de-ad89-6c145f86faf9",
  },
];

type SmaTableCellRow = string[];
type SmaPortalCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
};
type SmaStorageOrigin = {
  origin: string;
  localStorage?: Array<{ name: string; value: string }>;
};

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseCsvTextToRows(csvText: string): SmaTableCellRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  return lines
    .map((line) => parseCsvLine(line, delimiter))
    .filter((cells) => cells.length >= 2);
}

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateTextToUtcDate(text: string): Date | null {
  const normalized = text
    .trim()
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[./]/g, "-")
    .replace(/\s+/g, "");
  const ymd = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const y = Number(ymd[1]);
    const mo = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
    }
  }

  // 2桁年（例: 26/04/14 => 2026-04-14）
  const y2md = normalized.match(/(\d{2})-(\d{1,2})-(\d{1,2})/);
  if (y2md) {
    const y = Number(y2md[1]);
    const mo = Number(y2md[2]);
    const d = Number(y2md[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(2000 + y, mo - 1, d, 0, 0, 0, 0));
    }
  }

  // 2桁年の M-D-YY / D-M-YY（例: 4/15/26, 15/4/26）
  const mdyOrDmy2 = normalized.match(/(\d{1,2})-(\d{1,2})-(\d{2})/);
  if (mdyOrDmy2) {
    const a = Number(mdyOrDmy2[1]);
    const b = Number(mdyOrDmy2[2]);
    const y = 2000 + Number(mdyOrDmy2[3]);
    let day = 0;
    let month = 0;
    if (a > 12 && b >= 1 && b <= 12) {
      // D-M-YY
      day = a;
      month = b;
    } else {
      // M-D-YY（英語UIで一般的）
      month = a;
      day = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(y, month - 1, day, 0, 0, 0, 0));
    }
  }

  // Sunny Portal の表示言語/地域により DD-MM-YYYY や MM-DD-YYYY になる場合がある
  const dmyOrMdy = normalized.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!dmyOrMdy) return null;
  const a = Number(dmyOrMdy[1]);
  const b = Number(dmyOrMdy[2]);
  const y = Number(dmyOrMdy[3]);
  if (!y) return null;

  let day = 0;
  let month = 0;
  if (a > 12 && b >= 1 && b <= 12) {
    // DD-MM-YYYY
    day = a;
    month = b;
  } else if (b > 12 && a >= 1 && a <= 12) {
    // MM-DD-YYYY
    month = a;
    day = b;
  } else {
    // 曖昧な場合は Sunny Portal で出やすい DD-MM-YYYY を優先
    day = a;
    month = b;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(y, month - 1, day, 0, 0, 0, 0));
}

function parseGenerationKwh(text: string): number | null {
  const normalized = text.replace(/kwh/gi, "").replace(/,/g, "").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function pickDateAndGenerationFromRow(cells: SmaTableCellRow): { dateUtc: Date | null; generation: number | null } {
  let dateUtc: Date | null = null;
  let generation: number | null = null;
  for (const cell of cells) {
    if (!dateUtc) {
      const d = parseDateTextToUtcDate(cell);
      if (d) dateUtc = d;
    }
    const g = parseGenerationKwh(cell);
    if (g !== null) {
      generation = generation === null ? g : Math.max(generation, g);
    }
  }
  return { dateUtc, generation };
}

function countRowsInRange(rows: SmaTableCellRow[], start: Date, end: Date): number {
  let count = 0;
  for (const cells of rows) {
    const parsed = pickDateAndGenerationFromRow(cells);
    if (!parsed.dateUtc || parsed.generation === null) continue;
    const t = parsed.dateUtc.getTime();
    if (t >= start.getTime() && t <= end.getTime()) count++;
  }
  return count;
}

function getRowsDateRange(rows: SmaTableCellRow[]): { min: Date | null; max: Date | null } {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const cells of rows) {
    const parsed = pickDateAndGenerationFromRow(cells);
    if (!parsed.dateUtc) continue;
    if (!min || parsed.dateUtc.getTime() < min.getTime()) min = parsed.dateUtc;
    if (!max || parsed.dateUtc.getTime() > max.getTime()) max = parsed.dateUtc;
  }
  return { min, max };
}

async function tryGoPreviousPeriod(page: any): Promise<boolean> {
  const clickPrevInContext = async (ctx: any): Promise<boolean> =>
    (await ctx
      .evaluate(() => {
        const isVisible = (el: Element) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
        };

        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>("button,a,span,div,[role='button'],[aria-label],[title]")
        ).filter(isVisible);
        const score = (el: HTMLElement): number => {
          const txt = [
            el.textContent ?? "",
            el.getAttribute("aria-label") ?? "",
            el.getAttribute("title") ?? "",
            el.getAttribute("class") ?? "",
          ]
            .join(" ")
            .toLowerCase();
          let s = -9999;
          if (/prev|previous|back|前|戻|earlier|left|chevron-left|arrow-left/.test(txt)) s = 60;
          if (/[<＜‹←]/.test(txt)) s = Math.max(s, 55);
          if (/next|次|forward|right/.test(txt)) s -= 80;
          return s;
        };
        let best: HTMLElement | null = null;
        let bestScore = -9999;
        for (const el of candidates) {
          const s = score(el);
          if (s > bestScore) {
            bestScore = s;
            best = el;
          }
        }
        if (best && bestScore >= 50) {
          best.click();
          return true;
        }
        return false;
      })
      .catch(() => false)) as boolean;

  for (const ctx of smaPageContexts(page)) {
    const ok = await clickPrevInContext(ctx);
    if (ok) {
      await smaDelay(1400, 450);
      return true;
    }
  }
  return false;
}

async function extractTableRowsFromContext(context: any): Promise<SmaTableCellRow[]> {
  const rows = (await context.evaluate(() => {
    const dateLike = (s: string) =>
      /(\d{4}[./-]\d{1,2}[./-]\d{1,2})|(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/.test(s);
    const numericLike = (s: string) => /-?\d+(?:[.,]\d+)?/.test(s);
    const dayWord = /(^|\b)(day|tag|日)(\b|$)/i;
    const monthWord = /(^|\b)(month|monat|月)(\b|$)/i;
    const yearWord = /(^|\b)(year|jahr|年)(\b|$)/i;
    const totalWord = /(^|\b)(total|sum|合計)(\b|$)/i;
    const ngWord = /(approval|url of the page|send e-?mail|mandatory field|configuration)/i;
    const isVisible = (el: Element) => {
      const style = window.getComputedStyle(el as HTMLElement);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const tables = Array.from(document.querySelectorAll("table"));
    let bestRows: string[][] = [];
    let bestScore = -1;
    let fallbackRows: string[][] = [];
    let fallbackScore = -1;

    for (const table of tables) {
      if (!isVisible(table)) continue;
      const tableRows = Array.from(table.querySelectorAll("tr"))
        .map((tr) =>
          Array.from(tr.querySelectorAll("th,td"))
            .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter((v) => v.length > 0 && v.length <= 120)
        )
        .filter((cells) => cells.length >= 2);

      if (tableRows.length === 0) continue;

      const flat = tableRows.flat();
      const headerText = flat.slice(0, 24).join(" ");
      const allText = flat.join(" ");
      if (ngWord.test(allText)) continue;
      const dateHits = flat.filter((x) => dateLike(x)).length;
      const kwhHits = flat.filter((x) => /kwh/i.test(x)).length;
      const numericHits = flat.filter((x) => numericLike(x)).length;
      const headerHits =
        Number(dayWord.test(headerText)) +
        Number(monthWord.test(headerText)) +
        Number(yearWord.test(headerText)) +
        Number(totalWord.test(headerText));
      const dataRowHits = tableRows.filter((cells) => {
        const joined = cells.join(" ");
        const hasDate = cells.some((c) => dateLike(c));
        const hasNumeric = cells.some((c) => numericLike(c) || /kwh/i.test(c));
        // ヘッダ行だけの誤検知を避ける
        const looksLikeHeaderOnly = /day|month|year|total/i.test(joined) && !hasDate;
        return hasDate && hasNumeric && !looksLikeHeaderOnly;
      }).length;

      // 実データ行（日付+数値）がある表を最優先。設定モーダル誤検知を避ける。
      if (dataRowHits > 0) {
        const score =
          dataRowHits * 20 + headerHits * 8 + Math.min(dateHits, 8) * 3 + Math.min(kwhHits + numericHits, 8);
        if (score > bestScore) {
          bestScore = score;
          bestRows = tableRows.filter((cells) => {
            const joined = cells.join(" ");
            const hasDate = cells.some((c) => dateLike(c));
            const hasNumeric = cells.some((c) => numericLike(c) || /kwh/i.test(c));
            const isHeader = /day|month|year|total/i.test(joined) && !hasDate;
            return (hasDate && hasNumeric) || isHeader;
          });
        }
      }

      // どうしても日付セルを拾えない画面向けフォールバック:
      // ヘッダ( Day / Month / Year / Total ) + 数値量で候補表を1つ保持
      const fallbackTableScore = headerHits * 12 + Math.min(kwhHits + numericHits, 12);
      if (fallbackTableScore > fallbackScore) {
        fallbackScore = fallbackTableScore;
        fallbackRows = tableRows.filter((cells) => {
          const joined = cells.join(" ");
          if (ngWord.test(joined)) return false;
          return !/approval|url of the page|send e-?mail|mandatory field|configuration/i.test(joined);
        });
      }
    }

    if (bestRows.length > 0) return bestRows;
    if (fallbackRows.length > 0) return fallbackRows;

    // ノイズ混入を避けるため、候補なしの場合は空配列にする
    return [];
  })) as SmaTableCellRow[];
  return rows;
}

async function extractTableRows(page: any): Promise<SmaTableCellRow[]> {
  const mainRows = await extractTableRowsFromContext(page).catch(() => []);
  if (mainRows.length > 0) return mainRows;

  const hasFrames = page && typeof page.frames === "function";
  if (!hasFrames) return [];

  const frames = (page.frames() as any[]).filter((f) => f && f !== page.mainFrame?.());
  for (const frame of frames) {
    const frameRows = await extractTableRowsFromContext(frame).catch(() => []);
    if (frameRows.length > 0) return frameRows;
  }
  return [];
}

/** Sunny Portal / OneTrust 等の同意バナーを閉じる（ユーザー方針: 「全て拒否する」） */
async function dismissSunnyPortalConsentIfPresent(page: any): Promise<boolean> {
  const tryTextDismissInContext = async (ctx: any): Promise<boolean> =>
    (await ctx
      .evaluate(() => {
        const isVisible = (el: Element) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none"
          );
        };
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, a, [role='button'], input[type='button'], input[type='submit'], span"
          )
        );
        for (const el of nodes) {
          if (!isVisible(el)) continue;
          const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t === "全て拒否する" || t === "すべて拒否する" || /^reject all$/i.test(t)) {
            el.click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false)) as boolean;

  const contexts: any[] = [page];
  if (typeof page.frames === "function") {
    const main = typeof page.mainFrame === "function" ? page.mainFrame() : null;
    for (const f of page.frames() as any[]) {
      if (f && f !== main) contexts.push(f);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ctx of contexts) {
      try {
        const handle = typeof ctx.$ === "function" ? await ctx.$("#onetrust-reject-all-handler") : null;
        if (handle && typeof handle.click === "function") {
          const box = typeof handle.boundingBox === "function" ? await handle.boundingBox() : null;
          if (box && box.width > 2 && box.height > 2) {
            await handle.click({ delay: 40 });
            return true;
          }
        }
      } catch {
        // ignore
      }
      if (await tryTextDismissInContext(ctx)) return true;
    }
    if (attempt < 2) await smaDelay(400, 180);
  }
  return false;
}

function smaPageContexts(page: any): any[] {
  const out: any[] = [page];
  if (typeof page.frames === "function") {
    const main = typeof page.mainFrame === "function" ? page.mainFrame() : null;
    for (const f of page.frames() as any[]) {
      if (f && f !== main) out.push(f);
    }
  }
  return out;
}

async function clickByText(page: any, patterns: RegExp[]): Promise<boolean> {
  return (await page
    .evaluate((rawPatterns: string[]) => {
      const regexes = rawPatterns.map((p) => new RegExp(p, "i"));
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>("a,button,span,div,li")
      );
      for (const el of candidates) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (!regexes.some((r) => r.test(text))) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        el.click();
        return true;
      }
      return false;
    }, patterns.map((p) => p.source))
    .catch(() => false)) as boolean;
}

async function trySwitchToDayView(page: any): Promise<void> {
  const clicked = await clickByText(page, [/^day$/i, /日次/i, /日\b/i]);
  if (clicked) {
    await smaDelay(2500, 650);
  }
}

async function trySwitchToMonthView(page: any): Promise<boolean> {
  const consentDismissed = await dismissSunnyPortalConsentIfPresent(page);
  if (consentDismissed) {
    logger.info("smaCollector: privacy/cookie banner dismissed before Month tab");
  }
  await smaDelay(500, 120);

  const tryClickMonthInContext = async (ctx: any): Promise<boolean> =>
    (await ctx
      .evaluate(() => {
        const isInCookieUi = (el: Element) =>
          !!el.closest?.(
            '#onetrust-consent-sdk, #onetrust-banner-sdk, [id*="onetrust" i], [class*="onetrust" i], [class*="cookiebanner" i], [class*="privacy-banner" i]'
          );

        const isVisible = (el: Element) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none"
          );
        };

        const wantsMonthLabel = (raw: string) => {
          const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
          if (!text) return false;
          if (text === "month" || text === "月" || text === "月次" || text.includes("月次")) return true;
          return /(^|\W)month(\W|$)/i.test(text);
        };

        const scoreElement = (el: HTMLElement, combinedText: string): number => {
          if (isInCookieUi(el)) return -9999;
          if (!wantsMonthLabel(combinedText)) return -9999;
          const trimmed = combinedText.replace(/\s+/g, " ").trim();
          let score = 0;
          if (trimmed === "month" || trimmed === "月" || trimmed === "月次") score += 140;
          else if (trimmed.length <= 14) score += 50;
          else score -= Math.min(100, Math.max(0, trimmed.length - 14));
          if (el.getAttribute("role") === "tab") score += 70;
          const tag = el.tagName;
          if (tag === "A" || tag === "BUTTON" || tag === "LI") score += 28;
          if (tag === "SPAN" || tag === "LABEL") score += 12;
          return score;
        };

        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            "a,button,span,div,li,[role='tab'],[aria-label],[title],img[alt],label"
          )
        );
        let best: { el: HTMLElement; score: number } | null = null;
        for (const el of candidates) {
          if (!isVisible(el)) continue;
          const combined = [
            el.textContent ?? "",
            el.getAttribute("aria-label") ?? "",
            el.getAttribute("title") ?? "",
            el.getAttribute("alt") ?? "",
          ]
            .join(" ")
            .trim();
          const s = scoreElement(el, combined);
          if (s < 0) continue;
          if (!best || s > best.score) best = { el, score: s };
        }
        if (best && best.score >= 32) {
          best.el.click();
          return true;
        }
        return false;
      })
      .catch(() => false)) as boolean;

  const contexts = smaPageContexts(page);
  for (const ctx of contexts) {
    const clicked = await tryClickMonthInContext(ctx);
    if (clicked) {
      await smaDelay(2500, 700);
      return true;
    }
  }

  await dismissSunnyPortalConsentIfPresent(page);
  await smaDelay(700, 200);
  for (const ctx of contexts) {
    const clicked = await tryClickMonthInContext(ctx);
    if (clicked) {
      await smaDelay(2500, 700);
      return true;
    }
  }
  return false;
}

async function tryOpenChartGear(page: any): Promise<boolean> {
  const clickInContext = async (ctx: any): Promise<boolean> =>
    (await ctx
      .evaluate(() => {
        const isVisible = (el: Element) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none"
          );
        };

        const gearLike = Array.from(
          document.querySelectorAll<HTMLElement>(
            'img[src*="settings" i], img[src*="gear" i], img[alt*="setting" i], img[title*="setting" i], img[alt*="gear" i], img[title*="gear" i], a[id*="Settings" i], a[class*="settings" i], button[id*="Settings" i], button[class*="settings" i], [aria-label*="setting" i], [title*="setting" i], [aria-label*="gear" i], [title*="gear" i]'
          )
        ).filter(isVisible);
        if (gearLike.length > 0) {
          (gearLike[0] as HTMLElement).click();
          return true;
        }

        // 画像の歯車はチャート右下の外側にあるため、右下近傍の小アイコンを探す
        const chartLike = Array.from(document.querySelectorAll<HTMLElement>("div,section,article,table"))
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width >= 360 && rect.height >= 220)
          .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
        if (!chartLike) return false;
        const rect = chartLike.rect;
        const nearRightBottom = Array.from(document.querySelectorAll<HTMLElement>("a,button,img,span,i"))
          .filter(isVisible)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.width > 40 || r.height > 40) return false;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return cx >= rect.right - 44 && cx <= rect.right + 34 && cy >= rect.bottom - 14 && cy <= rect.bottom + 42;
          })
          .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
        if (nearRightBottom.length > 0) {
          nearRightBottom[0].click();
          return true;
        }
        return false;
      })
      .catch(() => false)) as boolean;

  for (const ctx of smaPageContexts(page)) {
    if (await clickInContext(ctx)) {
      await smaDelay(1200, 350);
      return true;
    }
  }
  return false;
}

async function clickMiddleChartIcon(page: any): Promise<boolean> {
  const clickInContext = async (ctx: any): Promise<boolean> =>
    (await ctx
      .evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el as HTMLElement);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none"
        );
      };

      const byTextOrAttr = Array.from(document.querySelectorAll<HTMLElement>("a,button,img,span,i"))
        .filter((el) => isVisible(el))
        .find((el) => {
          const txt = `${el.textContent ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("alt") ?? ""}`.toLowerCase();
          return /download|csv|export|data/.test(txt);
        });
      if (byTextOrAttr) {
        byTextOrAttr.click();
        return true;
      }

      // エクスポート系の小アイコン群（3個並び）を優先して中央をクリック
      const groups = Array.from(document.querySelectorAll<HTMLElement>("div,span,ul"))
        .filter((g) => isVisible(g))
        .map((g) => ({
          g,
          items: Array.from(g.querySelectorAll<HTMLElement>("a,img,button,span")).filter(isVisible),
        }))
        .filter((x) => x.items.length >= 3);

      for (const { items } of groups) {
        // 右下のアイコン群を想定して、小さいボタンだけに絞る
        const small = items.filter((it) => {
          const r = it.getBoundingClientRect();
          return r.width <= 40 && r.height <= 40;
        });
        if (small.length < 3) continue;
        const middle = small[1];
        (middle as HTMLElement).click();
        return true;
      }

      // チャート近傍の小さいクリック要素を座標順に拾って中央を押す
      const chartLike = Array.from(document.querySelectorAll<HTMLElement>("div,section,article"))
        .filter((el) => {
          const cls = `${el.className ?? ""}`.toLowerCase();
          const id = `${el.id ?? ""}`.toLowerCase();
          return /chart|highcharts|energy|power/.test(`${cls} ${id}`);
        })
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width >= 400 && rect.height >= 240)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
      if (chartLike) {
        const rect = chartLike.rect;
        const smallNearChart = Array.from(document.querySelectorAll<HTMLElement>("a,button,img,span,i"))
          .filter((it) => isVisible(it))
          .filter((it) => {
            const r = it.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.width > 40 || r.height > 40) return false;
            const centerX = r.left + r.width / 2;
            const centerY = r.top + r.height / 2;
            return (
              centerX >= rect.left - 30 &&
              centerX <= rect.right + 30 &&
              centerY >= rect.top - 30 &&
              centerY <= rect.bottom + 30
            );
          })
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (smallNearChart.length >= 3) {
          const middle = smallNearChart[Math.floor(smallNearChart.length / 2)];
          middle.click();
          return true;
        }
      }

      // フォールバック: ダウンロード/エクスポート語を含む要素を直接クリック
      const direct = Array.from(document.querySelectorAll<HTMLElement>("a,button,img,span")).find((el) => {
        if (!isVisible(el)) return false;
        const txt = ((el.textContent ?? "") + " " + (el.getAttribute("title") ?? "") + " " + (el.getAttribute("alt") ?? "")).toLowerCase();
        return /download|csv|export|データ|保存/.test(txt);
      });
      if (direct) {
        direct.click();
        return true;
      }
      return false;
    })
    .catch(() => false)) as boolean;

  for (const ctx of smaPageContexts(page)) {
    const clicked = await clickInContext(ctx);
    if (clicked) return true;
  }
  return false;
}

async function tryDownloadCsvRows(page: any, userId: string, plantOid: string): Promise<SmaTableCellRow[]> {
  let csvBody: string | null = null;
  const downloadDir = path.join(os.tmpdir(), "sma-download", `${Date.now()}_${plantOid}`);
  await fs.mkdir(downloadDir, { recursive: true }).catch(() => {});
  const cdpSession =
    page && page.target && typeof page.target === "function"
      ? await page
          .target()
          .createCDPSession()
          .catch(() => null)
      : null;
  if (cdpSession && typeof cdpSession.send === "function") {
    await cdpSession
      .send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloadDir,
      })
      .catch(() => {});
  }
  const onResponse = async (res: any) => {
    try {
      const url = String(res.url?.() ?? "");
      const headers = (typeof res.headers === "function" ? res.headers() : {}) as Record<string, string>;
      const contentType = String(headers["content-type"] ?? headers["Content-Type"] ?? "").toLowerCase();
      const disposition = String(headers["content-disposition"] ?? "").toLowerCase();
      if (
        contentType.includes("text/csv") ||
        disposition.includes("attachment") ||
        /csv|download|export|chart/i.test(url)
      ) {
        const text = await res.text().catch(() => "");
        if (text && text.length > 0 && /[,;\t]/.test(text)) {
          csvBody = text;
        }
      }
    } catch {
      // ignore
    }
  };

  page.on("response", onResponse);
  try {
    const monthClicked = await trySwitchToMonthView(page);
    // Highcharts の Export Data API が有効なら、UIクリック不要で CSV を直接取得する。
    const csvFromHighchartsApi = (await page
      .evaluate(() => {
        const w = window as unknown as {
          Highcharts?: {
            charts?: Array<{
              getCSV?: () => string;
            }>;
          };
        };
        const charts = w.Highcharts?.charts ?? [];
        for (const chart of charts) {
          if (!chart || typeof chart.getCSV !== "function") continue;
          try {
            const csv = chart.getCSV();
            if (typeof csv === "string" && csv.trim().length > 0) {
              return csv;
            }
          } catch {
            // ignore chart api failure
          }
        }
        return null;
      })
      .catch(() => null)) as string | null;
    if (csvFromHighchartsApi && csvFromHighchartsApi.length > 0) {
      const rows = parseCsvTextToRows(csvFromHighchartsApi);
      logger.info("smaCollector: csv download parsed rows", {
        userId,
        extra: {
          plantOid,
          rowCount: rows.length,
          source: "highcharts_getCSV",
          csvHead: csvFromHighchartsApi.slice(0, 180),
        },
      });
      if (rows.length > 0) return rows;
    }

    const clickDownloadByKnownId = async (ctx: any): Promise<boolean> =>
      (await ctx
        .evaluate(() => {
          const opener = document.querySelector<HTMLElement>('img[id$="_OpenButtonsDivImg"]');
          if (opener) {
            opener.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            opener.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          }
          const button = document.querySelector<HTMLInputElement>(
            'input[id$="_ImageButtonDownload"], input[name$="$ImageButtonDownload"]'
          );
          if (!button) return false;
          button.click();
          return true;
        })
        .catch(() => false)) as boolean;
    for (const ctx of smaPageContexts(page)) {
      try {
        const clickedKnown = await clickDownloadByKnownId(ctx);
        if (clickedKnown) {
          logger.info("smaCollector: csv download clicked by known id", {
            userId,
            extra: { plantOid },
          });
          break;
        }
      } catch (e) {
        logger.warn("smaCollector: click known-id csv button failed", {
          userId,
          extra: { plantOid, error: String(e) },
        });
      }
    }

    const gearClicked = await tryOpenChartGear(page);
    const clicked = await clickMiddleChartIcon(page);
    logger.info("smaCollector: csv action clicked", {
      userId,
      extra: { plantOid, monthClicked, gearClicked, clicked },
    });
    if (!clicked) return [];
    await smaDelay(2500, 750);

    // ネットワークレスポンスに現れないDL（blob/直接保存）を拾うため、保存先を監視する。
    const pollMax = isSmaFastCollectMode() ? 16 : 20;
    for (let i = 0; i < pollMax; i++) {
      const files = await fs.readdir(downloadDir).catch(() => []);
      const stable = files.filter((f) => !/\.crdownload$|\.tmp$/i.test(f));
      const csvFile = stable.find((f) => /\.csv$/i.test(f));
      if (csvFile) {
        const buf = await fs.readFile(path.join(downloadDir, csvFile)).catch(() => null);
        if (buf && buf.length > 0) {
          const csvText = buf.toString("utf-8");
          const rows = parseCsvTextToRows(csvText);
          logger.info("smaCollector: csv file detected from download dir", {
            userId,
            extra: { plantOid, csvFile, rowCount: rows.length },
          });
          if (rows.length > 0) return rows;
        }
      }
      await smaDelay(400, 220);
    }

    const csvSnapshot = typeof csvBody === "string" ? csvBody : "";
    if (csvSnapshot.length === 0) return [];
    const rows = parseCsvTextToRows(csvSnapshot);
    logger.info("smaCollector: csv download parsed rows", {
      userId,
      extra: { plantOid, rowCount: rows.length, csvHead: csvSnapshot.slice(0, 180) },
    });
    return rows;
  } catch (e) {
    logger.warn("smaCollector: tryDownloadCsvRows failed", {
      userId,
      extra: { plantOid, error: String(e) },
    });
    return [];
  } finally {
    page.off("response", onResponse);
  }
}

async function gotoDailyReportIfPossible(page: any): Promise<boolean> {
  const clicked = await clickByText(page, [/日次レポート/i, /daily report/i]);
  if (!clicked) return false;
  await smaDelay(3000, 1000);
  return true;
}

async function extractRowsFromHighchartsFromContext(context: any): Promise<SmaTableCellRow[]> {
  const rows = (await context
    .evaluate(() => {
      const w = window as unknown as {
        Highcharts?: {
          charts?: Array<{
            xAxis?: Array<{ categories?: string[] }>;
            series?: Array<{
              name?: string;
              data?: Array<
                | number
                | [number, number]
                | { x?: number | string | null; y?: number | null; category?: string }
                | null
              >;
            }>;
          }>;
        };
      };
      const charts = w.Highcharts?.charts ?? [];
      let best: string[][] = [];

      for (const chart of charts) {
        const categories = chart?.xAxis?.[0]?.categories ?? [];
        const seriesList = chart?.series ?? [];
        for (const s of seriesList) {
          const data = Array.isArray(s?.data) ? s.data : [];
          if (categories.length === 0 || data.length === 0) continue;
          const out: string[][] = [];
          const count = Math.min(categories.length, data.length);
          for (let i = 0; i < count; i++) {
            const category = String(categories[i] ?? "").trim();
            const point = data[i];
            const y =
              typeof point === "number"
                ? point
                : Array.isArray(point)
                  ? typeof point[1] === "number"
                    ? point[1]
                    : null
                  : point && typeof point === "object" && typeof (point as { y?: number }).y === "number"
                    ? (point as { y: number }).y
                    : null;
            if (!category || y === null || !Number.isFinite(y)) continue;
            out.push([category, String(y)]);
          }
          if (out.length > best.length) best = out;
        }

        // datetime 軸では categories が空のケースがあるため x/y から復元する
        for (const s of seriesList) {
          const data = Array.isArray(s?.data) ? s.data : [];
          if (data.length === 0) continue;
          const out: string[][] = [];
          for (const point of data) {
            let xRaw: number | string | null = null;
            let yRaw: number | null = null;
            let categoryText: string | null = null;

            if (typeof point === "number") {
              continue;
            } else if (Array.isArray(point)) {
              xRaw = point[0];
              yRaw = typeof point[1] === "number" ? point[1] : null;
            } else if (point && typeof point === "object") {
              xRaw = point.x ?? null;
              yRaw = typeof point.y === "number" ? point.y : null;
              categoryText = typeof point.category === "string" ? point.category : null;
            }
            if (yRaw === null || !Number.isFinite(yRaw)) continue;

            let dateText = "";
            if (categoryText && categoryText.trim().length > 0) {
              dateText = categoryText.trim();
            } else if (typeof xRaw === "number" && Number.isFinite(xRaw)) {
              // UTC日付に正規化して既存 parser と整合させる
              const dt = new Date(xRaw);
              if (Number.isFinite(dt.getTime())) {
                dateText = dt.toISOString().slice(0, 10);
              }
            } else if (typeof xRaw === "string" && xRaw.trim().length > 0) {
              dateText = xRaw.trim();
            }
            if (!dateText) continue;
            out.push([dateText, String(yRaw)]);
          }
          if (out.length > best.length) best = out;
        }
      }
      return best;
    })
    .catch(() => [])) as SmaTableCellRow[];
  return rows;
}

async function extractRowsFromHighcharts(page: any): Promise<SmaTableCellRow[]> {
  const mainRows = await extractRowsFromHighchartsFromContext(page).catch(() => []);
  if (mainRows.length > 0) return mainRows;

  const hasFrames = page && typeof page.frames === "function";
  if (!hasFrames) return [];
  const mainFrame = typeof page.mainFrame === "function" ? page.mainFrame() : null;
  const frames = (page.frames() as any[]).filter((f) => f && f !== mainFrame);
  for (const frame of frames) {
    const frameRows = await extractRowsFromHighchartsFromContext(frame).catch(() => []);
    if (frameRows.length > 0) return frameRows;
  }
  return [];
}

async function extractRowsFromImageMap(page: any): Promise<SmaTableCellRow[]> {
  const extractFromContext = async (ctx: any): Promise<SmaTableCellRow[]> =>
    (await ctx
      .evaluate(() => {
        const out: string[][] = [];
        const areas = Array.from(
          document.querySelectorAll<HTMLAreaElement>('map[id*="_diagramMap"] area[title]')
        );
        for (const area of areas) {
          const title = (area.getAttribute("title") ?? "").trim();
          if (!title) continue;
          const lines = title
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter((x) => x.length > 0);
          if (lines.length < 2) continue;
          const dateLine = lines.find((l) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(l)) ?? "";
          if (!dateLine) continue;
          const numericLine =
            [...lines]
              .reverse()
              .find((l) => /-?\d+(?:[.,]\d+)?/.test(l)) ?? "";
          if (!numericLine) continue;
          out.push([dateLine, numericLine.replace(/,/g, "")]);
        }
        return out;
      })
      .catch(() => [])) as SmaTableCellRow[];

  const rows = await extractFromContext(page).catch(() => []);
  if (rows.length > 0) return rows;
  for (const frame of smaPageContexts(page).slice(1)) {
    const frameRows = await extractFromContext(frame).catch(() => []);
    if (frameRows.length > 0) return frameRows;
  }
  return [];
}

async function saveTraceSnapshot(page: any, userId: string, label: string): Promise<void> {
  if (!isDebugTraceEnabled()) return;
  try {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dir = path.join(os.tmpdir(), "sma-trace");
    await fs.mkdir(dir, { recursive: true });
    const base = `${new Date().toISOString().replace(/[:.]/g, "-")}_${userId}_${safeLabel}`;
    const screenshotPath = path.join(dir, `${base}.png`);
    const htmlPath = path.join(dir, `${base}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const html = (await page.content().catch(() => "")) as string;
    await fs.writeFile(htmlPath, html, "utf-8");

    logger.info("smaCollector: trace snapshot saved", {
      userId,
      extra: {
        label,
        screenshotPath,
        htmlPath,
        url: page.url?.() ?? null,
        title: await page.title().catch(() => ""),
      },
    });
  } catch (e) {
    logger.warn("smaCollector: trace snapshot failed", {
      userId,
      extra: { label, error: String(e) },
    });
  }
}

async function clickRedirectLinkAndResolvePage(
  page: any,
  plantOid: string
): Promise<{ page: any; urlAfterClick: string | null }> {
  const selector = `a[href*="/RedirectToPlant/${plantOid}"]`;
  const hasPlaywrightContext = page && typeof page.context === "function" && typeof page.waitForURL === "function";

  if (hasPlaywrightContext) {
    const context = page.context();
    const popupPromise =
      context && typeof context.waitForEvent === "function"
        ? context.waitForEvent("page", { timeout: 5000 }).catch(() => null)
        : Promise.resolve(null);
    await page.click(selector, { timeout: 15000 });
    const popup = await popupPromise;
    const targetPage = popup ?? page;
    if (targetPage === page) {
      await page.waitForURL(/sunnyportal\.com/i, { timeout: 15000 }).catch(() => {});
    } else if (typeof targetPage.waitForLoadState === "function") {
      await targetPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    }
    const urlAfterClick = typeof targetPage.url === "function" ? targetPage.url() : null;
    return { page: targetPage, urlAfterClick };
  }

  const browser = page.browser();
  const newTargetPromise = browser
    .waitForTarget((target: any) => target.opener() === page.target(), { timeout: 5000 })
    .catch(() => null);
  await page.click(selector);
  const newTarget = await newTargetPromise;
  if (newTarget) {
    const newPage = await newTarget.page();
    if (newPage) {
      await newPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      return { page: newPage, urlAfterClick: newPage.url() };
    }
  }
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  return { page, urlAfterClick: page.url() };
}

// NOTE: 旧実装（CSVダウンロード/画面遷移）で使っていたヘルパーは廃止

async function gotoNetworkIdle(page: any, url: string, timeoutMs?: number) {
  // Playwright は waitUntil: "networkidle"
  // Puppeteer は waitUntil: "networkidle2"（相当）
  const isPlaywright = page && typeof page.waitForLoadState === "function";
  const waitUntil = isPlaywright ? "networkidle" : "networkidle2";
  const opts: any = { waitUntil };
  if (typeof timeoutMs === "number") opts.timeout = timeoutMs;
  await page.goto(url, opts);
}

export async function runSmaCollectorCookie(
  userId: string,
  startDate: string,
  endDate: string,
  runtimeCookieJson?: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) return { ok: false, message: "日付形式が不正です", recordCount: 0, errorCount: 0 };

  let recordCount = 0;

  let cookieJsonSource: string | null = null;
  if (typeof runtimeCookieJson === "string" && runtimeCookieJson.trim().length > 0) {
    cookieJsonSource = runtimeCookieJson;
    logger.info("smaCollector: using runtime cookie json from auto login", {
      userId,
      extra: { cookieJsonHead: runtimeCookieJson.substring(0, 200) },
    });
  } else {
    const cookieRow = await prisma.smaCookieCache.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { cookieJson: true, expiresAt: true },
    });
    if (!cookieRow) {
      return { ok: false, message: SMA_COOKIE_MISSING_ERROR, recordCount: 0, errorCount: 0 };
    }
    cookieJsonSource = cookieRow.cookieJson;
    logger.info("smaCollector: loaded cookie json from cache", {
      userId,
      extra: {
        cookieJson: cookieRow.cookieJson.substring(0, 200),
      },
    });
  }

  const cookieJsonRaw = cookieJsonSource ?? "";
  let runtimeOrigins: SmaStorageOrigin[] = [];
  const parsedCookies = (() => {
    try {
      const parsed = JSON.parse(cookieJsonRaw) as any;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.cookies)) {
        const origins = Array.isArray(parsed.origins) ? parsed.origins : [];
        runtimeOrigins = origins.filter(
          (o: any) =>
            o &&
            typeof o.origin === "string" &&
            Array.isArray(o.localStorage)
        );
      }
      const cookieSource = Array.isArray(parsed?.cookies) ? parsed.cookies : parsed;
      if (Array.isArray(cookieSource)) {
        return cookieSource
          .filter((x: SmaPortalCookie) => typeof x?.name === "string" && typeof x?.value === "string")
          .map((x: SmaPortalCookie) => ({
            name: x.name,
            value: x.value,
            domain: typeof x.domain === "string" && x.domain.length > 0 ? x.domain : "www.sunnyportal.com",
            path: typeof x.path === "string" && x.path.length > 0 ? x.path : "/",
            httpOnly: typeof x.httpOnly === "boolean" ? x.httpOnly : true,
            secure: typeof x.secure === "boolean" ? x.secure : true,
            sameSite:
              x.sameSite === "None" || x.sameSite === "Strict" || x.sameSite === "Lax"
                ? x.sameSite
                : "Lax",
            expires: typeof x.expires === "number" ? x.expires : undefined,
          }));
      }
      if (parsed && typeof parsed === "object" && typeof parsed.formsLogin === "string") {
        return [
          {
            name: ".SunnyPortalFormsLogin",
            value: parsed.formsLogin,
            domain: "www.sunnyportal.com",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax" as const,
            expires: undefined,
          },
        ];
      }
      return [];
    } catch {
      return [];
    }
  })();
  if (!Array.isArray(parsedCookies) || parsedCookies.length === 0) {
    return { ok: false, message: "SMA Cookie が不正です。再登録してください。", recordCount: 0, errorCount: 0 };
  }

  const hasRuntimeCookies =
    typeof runtimeCookieJson === "string" && runtimeCookieJson.trim().length > 0;
  const formsLoginOnly = parsedCookies.filter(
    (c) => c.name === ".SunnyPortalFormsLogin" || c.name === "SunnyPortalFormsLogin"
  );
  const portalCookies = parsedCookies.filter((c) => /sunnyportal\.com/i.test(c.domain ?? ""));
  const hasFormsInPortal = portalCookies.some((c) => /SunnyPortalFormsLogin/i.test(c.name));
  // 複数 Cookie を登録済みなら sunnyportal 向けをまとめて注入（セッション維持に有効）
  const cookiesToInject = hasRuntimeCookies
    ? parsedCookies
    : portalCookies.length >= 2 && hasFormsInPortal
      ? portalCookies
      : formsLoginOnly;

  if (cookiesToInject.length === 0) {
    return {
      ok: false,
      message:
        hasRuntimeCookies
          ? "SMA自動ログイン後に有効なSunny Portal Cookieを取得できませんでした。/settings でSMAログイン情報を再保存して再実行してください。"
          : ".SunnyPortalFormsLogin が見つかりません。設定で value のみ、または Chrome の Cookie 配列（JSON）を登録してください。",
      recordCount: 0,
      errorCount: 0,
    };
  }

  const puppeteer = (await import("puppeteer-extra")).default;
  try {
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(StealthPlugin());
  } catch (e) {
    logger.warn("smaCollector: stealth plugin unavailable, continue without stealth", {
      userId,
      extra: { error: e instanceof Error ? e.message : String(e) },
    });
  }

  const browser = await puppeteer.launch({
    headless: isDebugHeadfulEnabled() ? false : true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"],
    slowMo: isDebugHeadfulEnabled() ? 200 : 0,
    defaultViewport: isDebugHeadfulEnabled() ? null : undefined,
  });

  logger.info("smaCollector: browser launch mode", {
    userId,
    extra: {
      headful: isDebugHeadfulEnabled(),
      trace: isDebugTraceEnabled(),
      envHeadful: process.env.SMA_DEBUG_HEADFUL ?? null,
      envTrace: process.env.SMA_DEBUG_TRACE ?? null,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
  });

  try {
    let page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en-US;q=0.9,en;q=0.8" }).catch(() => {});
    await page.emulateTimezone("Asia/Tokyo").catch(() => {});
    page.setDefaultTimeout(60000);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "language", { get: () => "ja-JP" });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US"] });
    });

    // Playwright: context.addCookies / context.cookies
    // Puppeteer: page.setCookie / page.cookies
    const pw = page as { context?: () => { addCookies?: (cookies: unknown) => Promise<void> } };
    const hasPlaywrightContext = pw && typeof pw.context === "function";
    const context = hasPlaywrightContext ? pw.context!() : null;
    const addCookiesFn =
      context && typeof context.addCookies === "function" ? context.addCookies : null;
    logger.info("smaCollector: cookies to inject", {
      userId,
      extra: {
        cookies: cookiesToInject.map((c: any) => ({
          name: c.name,
          domain: c.domain,
          valueHead: c.value?.substring(0, 8),
        })),
      },
    });

    const cookiesForPuppeteer = cookiesToInject.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
    }));
    const cookiesForPlaywright = cookiesToInject.map((c) => ({
      name: c.name,
      value: c.value,
      url: /sma\.energy/i.test(c.domain ?? "")
        ? "https://login.sma.energy"
        : "https://www.sunnyportal.com",
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
    }));
    if (addCookiesFn) {
      await addCookiesFn(cookiesForPlaywright);
    } else {
      await page.setCookie(...cookiesForPuppeteer);
    }

    if (hasRuntimeCookies && runtimeOrigins.length > 0) {
      const targetOrigins = runtimeOrigins.filter((o) =>
        /login\.sma\.energy|sunnyportal\.com/i.test(o.origin)
      );
      for (const originState of targetOrigins) {
        const storageItems = (originState.localStorage ?? []).filter(
          (i) => typeof i?.name === "string" && typeof i?.value === "string"
        );
        if (storageItems.length === 0) continue;
        await page.goto(originState.origin, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page
          .evaluate((items: Array<{ name: string; value: string }>) => {
            for (const i of items) {
              try {
                localStorage.setItem(i.name, i.value);
              } catch {
                // ignore storage set failure
              }
            }
          }, storageItems)
          .catch(() => {});
      }
    }

    const isAuthenticatedAtPlants = async () => {
      const plantsTitle = await page.title().catch(() => "");
      const plantsUrl = page.url();
      const isAuthenticated =
        plantsTitle.includes("一覧") ||
        plantsTitle.includes("List") ||
        (plantsUrl.includes("/Plants") && !plantsUrl.includes("Start.aspx"));
      logger.info("smaCollector: /Plants auth check", {
        userId,
        extra: { title: plantsTitle, url: plantsUrl, isAuthenticated },
      });
      return isAuthenticated;
    };

    await gotoNetworkIdle(page, "https://www.sunnyportal.com/Plants");
    await saveTraceSnapshot(page, userId, "plants_initial");
    const currentCookies = await page.cookies();
    const documentCookieAtPlants = (await page.evaluate(() => document.cookie).catch(() => "")) as string;
    const redirectLinksOnPlants = (await page
      .evaluate(() => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="RedirectToPlant"]'));
        return anchors
          .map((a) => {
            const href = a.getAttribute("href") ?? "";
            const text = (a.textContent ?? "").trim();
            const m = href.match(/RedirectToPlant\/([a-f0-9-]+)/i);
            return {
              text,
              href,
              plantOid: m ? m[1] : null,
            };
          })
          .filter((x) => x.href.length > 0);
      })
      .catch(() => [])) as Array<{ text: string; href: string; plantOid: string | null }>;
    logger.info("smaCollector: cookies after /Plants goto", {
      userId,
      extra: {
        names: currentCookies.map((c: any) => c.name),
        hasFormsLogin: currentCookies.some((c: any) => c.name === ".SunnyPortalFormsLogin"),
        documentCookieHead: documentCookieAtPlants.substring(0, 500),
      },
    });
    logger.info("smaCollector: /Plants redirect links", {
      userId,
      extra: { count: redirectLinksOnPlants.length, links: redirectLinksOnPlants },
    });
    await smaDelay(2000, 380);
    let isAuthenticated = await isAuthenticatedAtPlants();
    if (!isAuthenticated && hasRuntimeCookies) {
      logger.info("smaCollector: trying silent SSO login for runtime cookies", { userId });
      await gotoNetworkIdle(page, SUNNY_PORTAL_SILENT_LOGIN_URL, 30000).catch(() => {});
      await smaDelay(1500, 650);
      await gotoNetworkIdle(page, "https://www.sunnyportal.com/Plants", 30000).catch(() => {});
      await smaDelay(1500, 650);
      isAuthenticated = await isAuthenticatedAtPlants();
    }
    if (!isAuthenticated) {
      return {
        ok: false,
        message:
          "Sunny Portal の認証に失敗しました。Cookie を再登録するか、設定の「Cookie 配列（JSON）」で www.sunnyportal.com の Cookie をまとめて登録してください。",
        recordCount: 0,
        errorCount: 0,
      };
    }

    if (await dismissSunnyPortalConsentIfPresent(page)) {
      logger.info("smaCollector: privacy/cookie banner dismissed after /Plants auth");
    }

    let stationErrors = 0;

    // 発電所ループ: /Plants のリンクから plantOid を取得し、RedirectToPlant -> EnergyAndPower
    for (const station of SMA_STATIONS) {
      throwIfAllCollectCancelled(userId);
      try {
      const plantName = station.displayName;
      logger.info("smaCollector: processing station", { userId, extra: { plantName } });
      await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "domcontentloaded" });
      await smaDelay(1000, 320);
      await saveTraceSnapshot(page, userId, `plants_before_pick_${station.plantId}`);
      const discoveredPlantOid = await page.evaluate((name: string) => {
        const rows = Array.from(document.querySelectorAll("tr"));
        for (const row of rows) {
          if (row.textContent?.includes(name)) {
            const link = row.querySelector('a[href*="RedirectToPlant"]') as HTMLAnchorElement | null;
            const href = link?.getAttribute("href") ?? "";
            const match = href.match(/RedirectToPlant\/([a-f0-9-]+)/i);
            return match ? match[1] : null;
          }
        }
        return null;
      }, plantName);
      const plantOid = discoveredPlantOid ?? station.plantId;
      if (!plantOid) {
        logger.warn("smaCollector: plantOid not found on /Plants", { userId, extra: { plantName } });
        stationErrors++;
        continue;
      }

      // 発電所選択は goto 直打ちではなく /Plants の実リンク click で遷移させる。
      await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "domcontentloaded" });
      await smaDelay(1000, 320);
      try {
        const clickResult = await clickRedirectLinkAndResolvePage(page, plantOid);
        if (clickResult.page !== page) {
          page = clickResult.page;
        }
        logger.info("smaCollector: redirect target navigated", {
          userId,
          extra: { plantName, plantOid, urlAfterClick: clickResult.urlAfterClick },
        });
        await smaDelay(2000, 550);
        await saveTraceSnapshot(page, userId, `after_redirect_${plantOid}`);
      } catch (e) {
        logger.warn("smaCollector: RedirectToPlant goto failed", {
          userId,
          extra: { plantName, plantOid, error: String(e) },
        });
      }

      const afterRedirectUrl = page.url();
      const afterRedirectTitle = await page.title().catch(() => "");
      logger.info("smaCollector: after RedirectToPlant", {
        userId,
        extra: { afterRedirectUrl, afterRedirectTitle, plantOid, plantName },
      });

      // error=show / Start.aspx の場合はここでスキップ
      if (afterRedirectUrl.includes("error=show") || afterRedirectUrl.includes("Start.aspx")) {
        logger.warn("smaCollector: RedirectToPlant did not select plant", {
          userId,
          extra: { plantName, plantOid, afterRedirectUrl, afterRedirectTitle },
        });
        stationErrors++;
        continue;
      }

      await page.goto("https://www.sunnyportal.com/FixedPages/EnergyAndPower.aspx", { waitUntil: "domcontentloaded" });
      await smaDelay(3000, 1000);
      if (await dismissSunnyPortalConsentIfPresent(page)) {
        logger.info("smaCollector: privacy/cookie banner dismissed on EnergyAndPower", {
          userId,
          extra: { plantName, plantOid },
        });
      }
      await saveTraceSnapshot(page, userId, `energy_page_${plantOid}`);
      await trySwitchToMonthView(page);
      await saveTraceSnapshot(page, userId, `energy_month_try_${plantOid}`);

      const url = page.url();
      const title = await page.title().catch(() => "");
      const isEnergyUrl = /\/FixedPages\/EnergyAndPower\.aspx/i.test(url);
      const isEnergyTitle = title.includes("出力と発電量") || title.includes("Energy");
      // タイトル取得が空文字になる瞬間があるため、URL判定を優先してページ到達扱いにする
      const isEnergyPage = isEnergyUrl || isEnergyTitle;
      logger.info("smaCollector: EnergyAndPower result", {
        userId,
        extra: { plantName, plantOid, energyUrl: url, energyTitle: title, isEnergyUrl, isEnergyTitle, isEnergyPage },
      });

      if (!isEnergyPage) {
        logger.warn("smaCollector: EnergyAndPower page not reached", {
          userId,
          extra: { plantName, title, url },
        });
        stationErrors++;
        continue;
      }

      const site = await prisma.site.findFirst({
        where: { siteName: station.siteName },
        select: { id: true },
      });
      if (!site) {
        logger.warn("smaCollector: Site row missing for SMA station", {
          userId,
          extra: { siteName: station.siteName, plantName },
        });
        stationErrors++;
        continue;
      }

      let finalRows: SmaTableCellRow[] = [];
      let finalSource = "none";
      let bestRows: SmaTableCellRow[] = [];
      let bestSource = "none";
      let bestInRange = 0;
      const adoptCandidate = (rows: SmaTableCellRow[], source: string) => {
        if (rows.length === 0) return;
        const inRange = countRowsInRange(rows, start, end);
        const shouldAdopt =
          inRange > bestInRange || (inRange === bestInRange && rows.length > bestRows.length);
        if (shouldAdopt) {
          bestRows = rows;
          bestSource = source;
          bestInRange = inRange;
        }
      };

      const tableRows = await extractTableRows(page);
      adoptCandidate(tableRows, "table");

      const chartRows = await extractRowsFromHighcharts(page);
      if (chartRows.length > 0) {
        adoptCandidate(chartRows, "highcharts");
        logger.info("smaCollector: using highcharts extracted rows", {
          userId,
          extra: { plantName, plantOid, rowCount: chartRows.length },
        });
      }

      const imageMapRows = await extractRowsFromImageMap(page);
      if (imageMapRows.length > 0) {
        adoptCandidate(imageMapRows, "imagemap");
        logger.info("smaCollector: using image map extracted rows", {
          userId,
          extra: { plantName, plantOid, rowCount: imageMapRows.length },
        });
      }

      if (bestInRange === 0) {
        // 表示期間が当月固定で対象月に合っていない場合、前期間へ移動して再抽出する
        for (let i = 0; i < 4 && bestInRange === 0; i++) {
          const moved = await tryGoPreviousPeriod(page);
          if (!moved) break;
          const movedTableRows = await extractTableRows(page);
          adoptCandidate(movedTableRows, `table_prev_${i + 1}`);
          const movedChartRows = await extractRowsFromHighcharts(page);
          adoptCandidate(movedChartRows, `highcharts_prev_${i + 1}`);
          const movedImageMapRows = await extractRowsFromImageMap(page);
          adoptCandidate(movedImageMapRows, `imagemap_prev_${i + 1}`);
          const range = getRowsDateRange(bestRows);
          logger.info("smaCollector: previous period retry", {
            userId,
            extra: {
              plantName,
              plantOid,
              step: i + 1,
              rowCountInRange: bestInRange,
              bestSource,
              bestMinDate: range.min ? range.min.toISOString().slice(0, 10) : null,
              bestMaxDate: range.max ? range.max.toISOString().slice(0, 10) : null,
            },
          });
        }
      }

      // 既に指定期間の行が取れている場合は、画面遷移を誘発しやすいCSV操作をスキップして安定性を優先
      if (bestInRange === 0) {
        const csvRows = await tryDownloadCsvRows(page, userId, plantOid);
        if (csvRows.length > 0) {
          adoptCandidate(csvRows, "csv");
          await saveTraceSnapshot(page, userId, `energy_csv_download_${plantOid}`);
        }
      }

      if (bestInRange === 0) {
        const movedToDailyReport = await gotoDailyReportIfPossible(page);
        if (movedToDailyReport) {
          await saveTraceSnapshot(page, userId, `daily_report_${plantOid}`);
          await trySwitchToMonthView(page);
          await tryOpenChartGear(page);
          await saveTraceSnapshot(page, userId, `daily_report_month_try_${plantOid}`);
          const dailyTableRows = await extractTableRows(page);
          adoptCandidate(dailyTableRows, "daily_report_table");
          const dailyChartRows = await extractRowsFromHighcharts(page);
          adoptCandidate(dailyChartRows, "daily_report_highcharts");
          const dailyCsvRows = await tryDownloadCsvRows(page, userId, plantOid);
          adoptCandidate(dailyCsvRows, "daily_report_csv");
          logger.info("smaCollector: daily report fallback rows", {
            userId,
            extra: {
              plantName,
              plantOid,
              movedToDailyReport,
              rowCount: bestRows.length,
              url: page.url(),
              title: await page.title().catch(() => ""),
            },
          });
        }
      }
      finalRows = bestRows;
      finalSource = bestSource;
      const parsePreview = finalRows.slice(0, 6).map((cells) => {
        const parsed = pickDateAndGenerationFromRow(cells);
        return {
          row: cells.slice(0, 4),
          parsedDate: parsed.dateUtc ? parsed.dateUtc.toISOString().slice(0, 10) : null,
          parsedGeneration: parsed.generation,
        };
      });
      logger.info("smaCollector: extracted table rows", {
        userId,
        extra: {
          plantName,
          plantOid,
          rowCount: finalRows.length,
          rowCountInRange: countRowsInRange(finalRows, start, end),
          selectedSource: finalSource,
          parsePreview,
        },
      });

      if (finalRows.length === 0) {
        const html = (await page.content()) as string;
        logger.warn("smaCollector: no table rows on energy page", {
          userId,
          extra: { plantName, plantOid, htmlHead: html.substring(0, 2000) },
        });
        stationErrors++;
        continue;
      }

      throwIfAllCollectCancelled(userId);
      const upserts = finalRows
        .map((cells) => pickDateAndGenerationFromRow(cells))
        .filter(
          ({ dateUtc, generation }) =>
            dateUtc !== null &&
            generation !== null &&
            dateUtc.getTime() >= start.getTime() &&
            dateUtc.getTime() <= end.getTime()
        )
        .map(({ dateUtc, generation }) =>
          prisma.dailyGeneration.upsert({
            where: {
              siteId_date: {
                siteId: site.id,
                date: dateUtc!,
              },
            },
            create: {
              siteId: site.id,
              date: dateUtc!,
              generation: generation!,
              status: "sma",
            },
            update: {
              generation: generation!,
              status: "sma",
              updatedAt: new Date(),
            },
          })
        );
      if (upserts.length > 0) {
        await prisma.$transaction(upserts);
        recordCount += upserts.length;
      }
      } catch (stationErr) {
        logger.warn("smaCollector: station run failed", {
          userId,
          extra: { station: station.displayName, error: String(stationErr) },
        });
        stationErrors++;
      }
    }

    const allStationsFailed = stationErrors >= SMA_STATIONS.length && recordCount === 0;
    const noDataInRange = stationErrors === 0 && recordCount === 0;
    return {
      ok: !allStationsFailed,
      message: allStationsFailed
        ? `SMA の全発電所で取得に失敗しました（${SMA_STATIONS.length} 件）。Cookie ・発電所名（${SMA_STATIONS.map((s) => s.displayName).join(" / ")}）を確認してください。`
        : noDataInRange
          ? "SMA への接続と画面遷移は成功しましたが、指定期間内の取得対象データは見つかりませんでした（保存: 0 件）。期間を広げて再実行してください。"
        : `SMA データ取得が完了しました（保存: ${recordCount} 件 / 発電所スキップ: ${stationErrors} 件）。`,
      recordCount,
      errorCount: stationErrors,
    };
  } catch (e) {
    logger.error("smaCollectorCookie failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "SMA データ取得に失敗しました。",
      recordCount,
      errorCount: 0,
    };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await browser.close().catch(() => {});
  }
}

