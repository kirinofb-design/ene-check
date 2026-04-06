import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { runSmaCollectorCookie } from "@/lib/smaCollectorCookie";

const SMA_LOGIN_URL =
  "https://login.sma.energy/auth/realms/SMA/protocol/openid-connect/auth?response_type=code&client_id=SunnyPortalClassic&client_secret=baa6d5fe-f905-4fb2-bc8e-8f218acc2835&redirect_uri=https%3a%2f%2fwww.sunnyportal.com%2fTemplates%2fStart.aspx&ui_locales=ja";

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

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getMonthsInRange(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cur <= end) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

async function clickByText(page: any, text: string): Promise<boolean> {
  const escaped = text.replace(/"/g, '\\"');
  const xpath = `//a[contains(normalize-space(.), "${escaped}")]`;
  const handles = await page.$x(xpath);
  if (!handles?.length) return false;
  await handles[0].click();
  return true;
}

function newestDownload(tmpDir: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const files = fs
    .readdirSync(tmpDir)
    .filter((f: string) => f.endsWith(".csv") || f.endsWith(".txt") || f.endsWith(".crdownload"))
    .map((f: string) => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtime.getTime() }))
    .sort((a: any, b: any) => b.time - a.time);
  return files.length ? path.join(tmpDir, files[0].name) : null;
}

export async function runSmaCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) return { ok: false, message: "日付形式が不正です", recordCount: 0, errorCount: 0 };

  // 方針転換: DB保存した SMA Cookie を注入して収集（レガシーOAuthフローは実行しない）
  return await runSmaCollectorCookie(userId, startDate, endDate);

  const cred = await prisma.monitoringCredential.findFirst({
    where: { userId, systemId: "sunny-portal" },
    select: { loginId: true, encryptedPassword: true },
  });
  if (!cred)
    return {
      ok: false,
      message: "SMAの認証情報が未登録です（/settingsで登録してください）。",
      recordCount: 0,
      errorCount: 0,
    };

  const loginId = cred.loginId;
  const password = decryptSecret(cred.encryptedPassword);
  const months = getMonthsInRange(start, end);

  let recordCount = 0;
  let errorCount = 0;

  const puppeteer = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
  });

  try {
    const page = await browser.newPage();
    // 実ブラウザに寄せて偽装（bot判定を下げる）
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    });
    await page.emulateTimezone("Asia/Tokyo").catch(() => {});
    await page.evaluateOnNewDocument(() => {
      // webdriver / plugins / languages は bot判定に使われがち
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      Object.defineProperty(screen, "width", { get: () => 1920 });
      Object.defineProperty(screen, "height", { get: () => 1080 });
      Object.defineProperty(navigator, "language", { get: () => "ja-JP" });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US"] });
    });
    page.setDefaultTimeout(60000);

    // レスポンスを監視
    page.on("response", async (resp: any) => {
      const url = resp.url();
      if (
        url.includes("sunnyportal.com") &&
        !url.includes(".js") &&
        !url.includes(".css") &&
        !url.includes(".gif") &&
        !url.includes(".png") &&
        !url.includes(".ico") &&
        !url.includes(".axd")
      ) {
        const headers = resp.headers();
        const method = resp.request().method();
        const status = resp.status();

        // 全ヘッダーを記録（POSTの場合のみ）
        if (method === "POST") {
          logger.info("smaCollector: POST response headers", {
            userId,
            extra: {
              url: url.substring(0, 100),
              status,
              // ヘッダー名はlowercaseで返ることが多い
              botHeader: headers["bot"] ?? headers["Bot"] ?? null,
              headers,
            },
          });
        } else {
          if (headers["set-cookie"]) {
            logger.info("smaCollector: set-cookie", {
              userId,
              extra: { url: url.substring(0, 80), setCookie: headers["set-cookie"].substring(0, 200) },
            });
          }
          logger.info("smaCollector: response", {
            userId,
            extra: { url: url.substring(0, 80), status, method },
          });
        }
      }
    });

    // ログイン
    logger.info("smaCollector: login start", { userId });
    await page.goto(SMA_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await page.type('input[type="email"], input[type="text"]', loginId);
    await page.type('input[type="password"]', password);
    await page.click('button[type="submit"]');

    // sunnyportal.comに到達するまでポーリング
    let loginSuccess = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const currentUrl = page.url();
      if (currentUrl.includes("sunnyportal.com")) {
        loginSuccess = true;
        break;
      }
    }
    if (!loginSuccess) throw new Error(`ログイン失敗: ${page.url()}`);
    logger.info("smaCollector: login success", { userId, extra: { url: page.url() } });

    // 新方針: Sunny Portal 内部 API を Cookie 付きで直接叩く
    // （.SunnyPortalFormsLogin が取れない場合の回避策）
    try {
      const startDateStr = startDate;
      const endDateStr = endDate;

      const cookiesNow = await page.cookies("https://www.sunnyportal.com");
      const cookieNames = cookiesNow.map((c: any) => c.name);
      logger.info("smaCollector: cookies after login success (for api)", {
        userId,
        extra: { cookieNames },
      });

      const endpoints = [
        "https://www.sunnyportal.com/homemanager",
        "https://www.sunnyportal.com/Plants",
        "https://www.sunnyportal.com/api/plant",
        "https://www.sunnyportal.com/CustomerPlants",
      ];

      const apiProbeResults = await page.evaluate(async (urls: string[]) => {
        const MAX_BODY = 20000;
        async function probe(url: string) {
          const resp = await fetch(url, { credentials: "include" });
          const headers: Record<string, string> = {};
          resp.headers.forEach((v, k) => {
            headers[k] = v;
          });
          const contentType = headers["content-type"] ?? "";
          if (contentType.includes("application/json")) {
            const body = await resp.json();
            return { url: resp.url, status: resp.status, ok: resp.ok, contentType, headers, body };
          }
          const text = await resp.text();
          return {
            url: resp.url,
            status: resp.status,
            ok: resp.ok,
            contentType,
            headers,
            body: text.slice(0, MAX_BODY),
            truncated: text.length > MAX_BODY,
          };
        }

        const results: any[] = [];
        for (const url of urls) {
          try {
            results.push(await probe(url));
          } catch (e: any) {
            results.push({
              url,
              status: 0,
              ok: false,
              contentType: "",
              headers: {},
              error: String(e?.message ?? e),
            });
          }
        }
        return results;
      }, endpoints);

      logger.info("smaCollector: internal api probe results", { userId, extra: { apiProbeResults } });

      const jsonResults = apiProbeResults.filter((r: any) => r?.contentType?.includes("application/json") && r?.body != null);

      const extractArrayFromJson = (body: any): any[] | null => {
        if (!body) return null;
        if (Array.isArray(body)) return body;
        if (Array.isArray(body.plants)) return body.plants;
        if (Array.isArray(body.data)) return body.data;
        if (Array.isArray(body.items)) return body.items;
        if (Array.isArray(body.result)) return body.result;
        if (Array.isArray(body.customerPlants)) return body.customerPlants;
        return null;
      };

      const plantListCandidate = (() => {
        for (const r of jsonResults) {
          const arr = extractArrayFromJson(r.body);
          if (!arr || arr.length === 0) continue;
          // ある程度の候補として、各要素がオブジェクトっぽいかを見る
          const hasNameish = arr.some((p: any) => typeof p === "object" && (p?.name || p?.plantName || p?.displayName));
          if (hasNameish) return arr;
        }
        return null;
      })();

      if (!plantListCandidate) {
        logger.warn("smaCollector: plant list json not found from api probes; fallback to Start.aspx/Plants", {
          userId,
        });
        throw new Error("internal api plant list not found");
      }

      // station.plantId でマッチできるものを探す
      const getPlantId = (p: any) => p?.plantId ?? p?.id ?? p?.plant_id ?? p?.plantGuid ?? p?.guid ?? p?.ne ?? null;
      const getPlantName = (p: any) => p?.name ?? p?.plantName ?? p?.displayName ?? p?.label ?? null;

      const plantsById: Record<string, any> = {};
      const plantsByName: Record<string, any> = {};
      for (const p of plantListCandidate) {
        const id = getPlantId(p);
        const name = getPlantName(p);
        if (id) plantsById[String(id)] = p;
        if (name) plantsByName[String(name)] = p;
      }

      const extractDailyRecords = (body: any): { date: string; generation: number }[] => {
        const arr = extractArrayFromJson(body) ?? (Array.isArray(body) ? body : null);
        if (!arr) return [];
        const records: { date: string; generation: number }[] = [];
        for (const item of arr) {
          const dateStr =
            item?.date ??
            item?.ymd ??
            item?.day ??
            item?.measureDate ??
            item?.measurementDate ??
            item?.measurement_day ??
            item?.dateStr ??
            null;
          const genStr =
            item?.generation ??
            item?.kwh ??
            item?.energy ??
            item?.value ??
            item?.pcsKwh ??
            item?.pcs_kwh ??
            item?.pcs ??
            null;
          if (!dateStr || genStr == null) continue;
          const normalizedDate = String(dateStr).trim().replace(/\//g, "-");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) continue;
          const gen = typeof genStr === "number" ? genStr : parseFloat(String(genStr).replace(/,/g, ""));
          if (Number.isNaN(gen)) continue;
          records.push({ date: normalizedDate, generation: gen });
        }
        return records;
      };

      // daily generation の候補エンドポイント（要ログ確認しつつ絞る）
      const dailyEndpointTemplates = [
        // パラメータ式（plantIdを渡す）
        `https://www.sunnyportal.com/api/plant/daily?plantId={{plantId}}&from={{from}}&to={{to}}`,
        `https://www.sunnyportal.com/api/plant/generation/daily?plantId={{plantId}}&from={{from}}&to={{to}}`,
        `https://www.sunnyportal.com/api/plant/report/daily?plantId={{plantId}}&startDate={{from}}&endDate={{to}}`,
        // パス式
        `https://www.sunnyportal.com/api/plant/{{plantId}}/daily?from={{from}}&to={{to}}`,
      ];

      let apiRecordCount = 0;
      let apiErrorCount = 0;

      // 期間の日付（YYYY-MM-DD）
      const from = startDateStr;
      const to = endDateStr;

      for (const station of SMA_STATIONS) {
        const site = await prisma.site.findFirst({
          where: { siteName: station.siteName },
          select: { id: true },
        });
        if (!site) {
          apiErrorCount++;
          continue;
        }

        const plant = plantsById[station.plantId] ?? plantsByName[station.displayName] ?? null;
        const plantIdForApi = plant ? getPlantId(plant) : station.plantId;

        if (!plantIdForApi) {
          apiErrorCount++;
          continue;
        }

        let collectedAnyForStation = false;

        for (const tpl of dailyEndpointTemplates) {
          const dailyUrl = tpl
            .replace("{{plantId}}", encodeURIComponent(String(plantIdForApi)))
            .replace("{{from}}", encodeURIComponent(from))
            .replace("{{to}}", encodeURIComponent(to));

          const dailyProbe = await page.evaluate(async (url: string) => {
            const resp = await fetch(url, { credentials: "include" });
            const headers: Record<string, string> = {};
            resp.headers.forEach((v, k) => {
              headers[k] = v;
            });
            const contentType = headers["content-type"] ?? "";
            if (contentType.includes("application/json")) {
              return {
                url: resp.url,
                status: resp.status,
                ok: resp.ok,
                contentType,
                headers,
                body: await resp.json(),
              };
            }
            const text = await resp.text();
            return {
              url: resp.url,
              status: resp.status,
              ok: resp.ok,
              contentType,
              headers,
              bodyText: text.slice(0, 20000),
              truncated: text.length > 20000,
            };
          }, dailyUrl);

          logger.info("smaCollector: daily api probe", {
            userId,
            extra: {
              url: dailyProbe?.url ?? dailyUrl,
              status: dailyProbe?.status,
              contentType: dailyProbe?.contentType,
              headers: dailyProbe?.headers,
              // JSONはそのまま、テキストは短縮
              body: dailyProbe?.body ?? dailyProbe?.bodyText,
              truncated: dailyProbe?.truncated,
            },
          });

          const dailyRecords = dailyProbe?.body ? extractDailyRecords(dailyProbe.body) : [];
          if (dailyRecords.length === 0) continue;

          for (const rec of dailyRecords) {
            const dateUtc = parseYmdToUtcDate(rec.date);
            if (!dateUtc) continue;
            if (dateUtc < start || dateUtc > end) continue;
            await prisma.dailyGeneration.upsert({
              where: { siteId_date: { siteId: site.id, date: dateUtc } },
              create: { siteId: site.id, date: dateUtc, generation: rec.generation, status: "sma" },
              update: { generation: rec.generation, status: "sma", updatedAt: new Date() },
            });
            apiRecordCount++;
          }

          collectedAnyForStation = true;
          break;
        }

        if (!collectedAnyForStation) {
          apiErrorCount++;
        }
      }

      if (apiRecordCount > 0) {
        return {
          ok: true,
          message: `SMAデータ取得完了（internal API: 保存: ${apiRecordCount}件 / スキップ: ${apiErrorCount}件）`,
          recordCount: apiRecordCount,
          errorCount: apiErrorCount,
        };
      }

      logger.warn("smaCollector: internal api did not collect any records; fallback to Start.aspx/Plants", {
        userId,
        extra: { apiRecordCount, apiErrorCount },
      });
      throw new Error("internal api collection produced no records");
    } catch (e) {
      logger.warn("smaCollector: internal api approach failed, fallback started", {
        userId,
        extra: { error: String(e instanceof Error ? e.message : e) },
      });
      // ここでは握りつぶして、既存の Start.aspx/Plants + CSV フローにフォールバックする
    }

    // OAuthコードをURLから取得（GETより先にPOSTを送るために、URL取得を先行させる）
    const loginUrl = page.url();
    const urlObj = new URL(loginUrl);
    const code = urlObj.searchParams.get("code");
    const sessionState = urlObj.searchParams.get("session_state");
    const iss = urlObj.searchParams.get("iss");

    logger.info("smaCollector: oauth params captured", {
      userId,
      extra: { code: code?.substring(0, 20) },
    });

    // 現在のCookieを取得
    const currentCookies = await page.cookies("https://www.sunnyportal.com");
    const cookieHeader = currentCookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
    logger.info("smaCollector: pre-post cookies", {
      userId,
      extra: { cookiePairCount: currentCookies.length, headerLen: cookieHeader.length },
    });

    // Start.aspxに対してPOSTリクエストを送信してセッションを確立
    // ページのViewState取得のために一度GETで画面を読み込む（その後すぐPOSTする）
    await page.waitForFunction(() => document.readyState === "complete");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const viewState = await page.evaluate(() => {
      const vs = document.querySelector('input[name="__VIEWSTATE"]') as HTMLInputElement | null;
      return vs?.value || "";
    });

    logger.info("smaCollector: viewstate", { userId, extra: { hasViewState: !!viewState } });

    const startUrl = `https://www.sunnyportal.com/Templates/Start.aspx?session_state=${sessionState}&iss=${encodeURIComponent(
      iss || "",
    )}&code=${code}`;

    const postResult = await page.evaluate(async (postUrl: string, vs: string) => {
      const body = new URLSearchParams({
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__VIEWSTATE": vs,
        "__VIEWSTATEGENERATOR": "4E24AF74",
      });

      const resp = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      const respText = await resp.text();
      return {
        status: resp.status,
        url: resp.url,
        hasSunnyPortalFormsLogin: document.cookie.includes("SunnyPortalFormsLogin"),
        cookieCount: document.cookie.split(";").length,
        snippet: respText.substring(0, 100),
      };
    }, startUrl, viewState);

    logger.info("smaCollector: post result", { userId, extra: postResult });

    // Cookieを再確認
    const cookiesAfterPost = await page.cookies("https://www.sunnyportal.com");
    logger.info("smaCollector: cookies after post", {
      userId,
      extra: { names: cookiesAfterPost.map((c: any) => c.name) },
    });

    const hasFormsLoginCookie = cookiesAfterPost.some((c: any) => c.name === ".SunnyPortalFormsLogin");
    if (!hasFormsLoginCookie) {
      logger.warn("smaCollector: .SunnyPortalFormsLogin missing after POST, fallback started", {
        userId,
        extra: { hasSunnyPortalFormsLogin: postResult?.hasSunnyPortalFormsLogin, startUrl },
      });

      // 1) POSTレスポンスから set-cookie を拾えた場合だけ手動注入（可能なら）
      let injectedFromSetCookie = false;
      try {
        let setCookieFound: string | null = null;

        const onResponse = (resp: any) => {
          try {
            const rUrl: string = resp.url();
            const method = resp.request().method();
            if (
              method === "POST" &&
              rUrl.includes("Templates/Start.aspx") &&
              typeof resp.headers === "function" &&
              resp.headers()["set-cookie"]
            ) {
              setCookieFound = resp.headers()["set-cookie"];
            }
          } catch {
            // ignore
          }
        };

        page.on("response", onResponse);
        // 少し待ってレスポンスを回収
        await new Promise((resolve) => setTimeout(resolve, 5000));
        page.off("response", onResponse);

        if (setCookieFound && setCookieFound.includes(".SunnyPortalFormsLogin")) {
          const match = setCookieFound.match(/\.SunnyPortalFormsLogin=([^;]+)/);
          if (match) {
            await page.setCookie({
              name: ".SunnyPortalFormsLogin",
              value: match[1],
              domain: "www.sunnyportal.com",
              path: "/",
              httpOnly: true,
              secure: true,
            });
            injectedFromSetCookie = true;
            logger.warn("smaCollector: injected .SunnyPortalFormsLogin from set-cookie", { userId });
          }
        }
      } catch (e) {
        logger.warn("smaCollector: fallback set-cookie inject failed", { userId, extra: { error: String(e) } });
      }

      // 2) fetch を諦めて、Start.aspx を直接開いてリダイレクトを完了させる
      if (!injectedFromSetCookie) {
        try {
          logger.warn("smaCollector: attempting page.goto(startUrl) as fallback", {
            userId,
            extra: { startUrl: startUrl.substring(0, 120) },
          });
          await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await new Promise((resolve) => setTimeout(resolve, 10000));
        } catch (e) {
          logger.warn("smaCollector: page.goto(startUrl) failed", { userId, extra: { error: String(e) } });
        }
      }

      const cookiesAfterFallback = await page.cookies("https://www.sunnyportal.com");
      logger.warn("smaCollector: cookies after fallback", {
        userId,
        extra: { names: cookiesAfterFallback.map((c: any) => c.name), hasFormsLogin: cookiesAfterFallback.some((c: any) => c.name === ".SunnyPortalFormsLogin") },
      });
    }

    // /Plantsに遷移
    await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "domcontentloaded" });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.info("smaCollector: plants url", { userId, extra: { url: page.url() } });

    // /Plants 直後のページ内容で maintenance を検知
    const plantsTitle = await page.title().catch(() => "");
    const plantsBodySnippet = await page
      .evaluate(() => document.body?.innerText?.slice(0, 1000) ?? "")
      .catch(() => "");
    const plantsLower = String(plantsBodySnippet).toLowerCase();
    if (plantsLower.includes("maintenance")) {
      throw new Error("Sunny Portal はメンテナンス中です。時間をおいて再実行してください。");
    }
    logger.info("smaCollector: maintenance check", {
      userId,
      extra: { title: plantsTitle, hasMaintenance: plantsLower.includes("maintenance") },
    });

    if (!page.url().includes("/Plants")) {
      const title = await page.title().catch(() => "");
      const bodyText = await page
        .evaluate(() => document.body?.innerText?.slice(0, 500) || "")
        .catch(() => "");
      logger.error("smaCollector: /Plants navigation failed", {
        userId,
        extra: { url: page.url(), title, bodySnippet: bodyText },
      });
      throw new Error(`/Plantsに到達できません: ${page.url()}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as typeof import("os");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    const downloadsDir = path.join(os.tmpdir(), `sma-downloads-${Date.now()}`);
    fs.mkdirSync(downloadsDir, { recursive: true });
    const client = await page.target().createCDPSession();
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir });

    // 発電所×月ループ
    for (const station of SMA_STATIONS) {
      logger.info("smaCollector: processing station", { userId, extra: { displayName: station.displayName } });

      // 発電所をクリック
      await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "networkidle2" });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const plantClicked = await clickByText(page, station.displayName);
      if (!plantClicked) {
        logger.warn("smaCollector: plant link not found", { userId, extra: { displayName: station.displayName } });
        errorCount++;
        continue;
      }
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
      logger.info("smaCollector: after plant click", { userId, extra: { url: page.url() } });

      // 「出力と発電量」をクリック
      const energyClicked = await clickByText(page, "出力と発電量");
      if (!energyClicked) {
        logger.warn("smaCollector: energy link not found", { userId });
        errorCount++;
        continue;
      }
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
      logger.info("smaCollector: energy page", { userId, extra: { url: page.url() } });

      for (const yearMonth of months) {
        const site = await prisma.site.findFirst({
          where: { siteName: station.siteName },
          select: { id: true },
        });
        if (!site) {
          errorCount++;
          continue;
        }

        const [year, month] = yearMonth.split("-");

        try {
          // 月タブをクリック
          await page.click('a[id*="LinkButton2"]').catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 500));

          // 年月セレクト
          await page.select('select[id*="Month"]', String(parseInt(month, 10))).catch(() => {});
          await page.select('select[id*="Year"]', year).catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // ダウンロード
          const before = newestDownload(downloadsDir);
          await page.click('a[id*="Download"]').catch(() => page.click('a[href*="DownloadDiagram"]'));
          await new Promise((resolve) => setTimeout(resolve, 4000));

          // ダウンロード完了まで少し待つ（.crdownload が消えるのを優先）
          let latest = newestDownload(downloadsDir);
          for (let i = 0; i < 30; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const cur = newestDownload(downloadsDir);
            if (cur && cur !== before && !cur.endsWith(".crdownload")) {
              latest = cur;
              break;
            }
          }

          if (!latest || latest === before || latest.endsWith(".crdownload")) {
            logger.warn("smaCollector: no csv found", { userId, extra: { yearMonth, latest } });
            errorCount++;
            continue;
          }

          const csvText = fs.readFileSync(latest, "latin1");
          logger.info("smaCollector: csv snippet", { userId, extra: { snippet: csvText.substring(0, 200) } });

          const lines = csvText.split("\n").slice(1);
          for (const line of lines) {
            const parts = line.trim().split(";");
            if (parts.length < 2 || !parts[1].trim()) continue;
            const fullDate = "20" + parts[0].trim().replace(/\//g, "-");
            const dateUtc = parseYmdToUtcDate(fullDate);
            if (!dateUtc || dateUtc < start || dateUtc > end) continue;
            const generation = parseFloat(parts[1].trim().replace(/,/g, ""));
            if (Number.isNaN(generation)) continue;
            await prisma.dailyGeneration.upsert({
              where: { siteId_date: { siteId: site.id, date: dateUtc } },
              create: { siteId: site.id, date: dateUtc, generation, status: "sma" },
              update: { generation, status: "sma", updatedAt: new Date() },
            });
            recordCount++;
          }
        } catch (e) {
          logger.warn("smaCollector: month failed", { userId, extra: { yearMonth, error: String(e) } });
          errorCount++;
        }
      }
    }

    return {
      ok: true,
      message: `SMAデータ取得完了（保存: ${recordCount}件 / スキップ: ${errorCount}件）`,
      recordCount,
      errorCount,
    };
  } catch (e) {
    logger.error("smaCollector failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "SMAデータ取得に失敗しました",
      recordCount,
      errorCount,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

