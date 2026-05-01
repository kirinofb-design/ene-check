import type { Browser } from "playwright-core";
import { access, mkdir, open, readdir, rm, stat, unlink } from "node:fs/promises";
import { constants as FsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

export async function importPlaywrightCore() {
  // Next の webpack が playwright-core を丸ごとバンドルすると失敗するので next.config で外部化する
  return await import("playwright-core");
}

function mergeChromiumArgs(base: string[] | undefined, extra: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of [base ?? [], extra ?? []]) {
    for (const arg of group) {
      if (!arg) continue;
      if (seen.has(arg)) continue;
      seen.add(arg);
      out.push(arg);
    }
  }
  return out;
}

type LaunchOpts = {
  headless?: boolean;
  slowMoMs?: number;
  extraArgs?: string[];
};

let vercelChromiumTaskChain: Promise<void> = Promise.resolve();

async function runSerializedOnVercel<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    return await task();
  };

  const next = vercelChromiumTaskChain.then(run, run);
  // 失敗してもチェーンを切らない（後続タスクが止まるのを防ぐ）
  vercelChromiumTaskChain = next.then(
    () => {},
    () => {}
  );
  return await next;
}

const CHROMIUM_BIN = join(tmpdir(), "chromium");
const CHROMIUM_BOOTSTRAP_LOCK = join(tmpdir(), "ene-sparticuz-chromium.bootstrap.lock");

/** Vercel/serverless では /dev/shm が極小になりやすく、これ無しだと Chromium が「共有メモリ用 tmp が枯渇」と警告して落ちる */
const VERCEL_CHROMIUM_STABILITY_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
] as const;

/** Code Cache が /tmp を食い潰すのを抑える（容量枯渇時に profile/Code Cache でコケやすい） */
const VERCEL_CHROMIUM_LOW_DISK_ARGS = ["--disk-cache-size=1", "--media-cache-size=1"] as const;

/** 収集処理が /tmp に残しやすいディレクトリ（Warm 再利用で積み上がり Fusion 最終段で枯渇しやすい） */
const VERCEL_TMP_SCRATCH_DIR_PREFIXES = [
  "playwright_chromiumdev_profile-",
  "playwright-artifacts-",
  "playwright-profile-",
  "solar-monitor-",
] as const;

const VERCEL_TMP_SCRATCH_DIR_NAMES = new Set(["sma-download", "sma-trace"]);

async function cleanupVercelCollectTmpScratch(): Promise<void> {
  const dir = tmpdir();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) return;

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    // sparticuz の実行ファイル・ロックは消さない
    if (entry.name === "chromium" || entry.name === "ene-sparticuz-chromium.bootstrap.lock") continue;

    if (entry.isDirectory()) {
      const byPrefix = VERCEL_TMP_SCRATCH_DIR_PREFIXES.some((p) => entry.name.startsWith(p));
      const byExact = VERCEL_TMP_SCRATCH_DIR_NAMES.has(entry.name);
      if (!byPrefix && !byExact) continue;
      await rm(fullPath, { recursive: true, force: true }).catch(() => {});
    }
    if (entry.isFile()) {
      const n = entry.name;
      const zap =
        (n.startsWith("laplace-") && n.endsWith(".zip")) ||
        (n.startsWith("eco-megane-") && n.endsWith(".csv"));
      if (zap) await unlink(fullPath).catch(() => {});
    }
  }
}

/** ブラウザ終了直後に呼び、次の順次収集リクエストへ `/tmp` を残さない（同一 Warm インスタンス対策） */
export async function sweepVercelCollectTmpAfterBrowserClose(): Promise<void> {
  if (!isVercelRuntime()) return;
  await sleep(500);
  await cleanupVercelCollectTmpScratch();
  await sleep(250);
  await cleanupVercelCollectTmpScratch();
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, FsConstants.F_OK | FsConstants.X_OK);
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Vercel の同時実行（別インスタンス）でも `/tmp/chromium` の生成競合を避けるための簡易ロック。
 * ロック取得に失敗した場合は待機してから続行する。
 */
async function withVercelChromiumBootstrapLock<T>(task: () => Promise<T>): Promise<T> {
  await mkdir(tmpdir(), { recursive: true }).catch(() => {});

  const maxWaitMs = 15_000;
  const start = Date.now();

  // ロック取得（同一プロセス内でも安全）
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const fh = await open(CHROMIUM_BOOTSTRAP_LOCK, "wx");
      try {
        return await task();
      } finally {
        await fh.close().catch(() => {});
        await unlink(CHROMIUM_BOOTSTRAP_LOCK).catch(() => {});
      }
    } catch {
      if (Date.now() - start > maxWaitMs) {
        return await task();
      }
      await sleep(50 + Math.floor(Math.random() * 50));
    }
  }
}

async function resolveSparticuzExecutablePath(): Promise<string> {
  const chromiumMod = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default ?? chromiumMod;

  // `/tmp/chromium` が存在しても不完全な中間状態があり得るため、実行可能でなければ削除して再生成させる
  const exists = await isExecutableFile(CHROMIUM_BIN);
  if (!exists) {
    await unlink(CHROMIUM_BIN).catch(() => {});
  }

  return await chromium.executablePath();
}

async function launchWithRetries(
  launchOnce: () => Promise<Browser>,
  attempts = 5
): Promise<Browser> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await launchOnce();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = msg.includes("ETXTBSY") || msg.includes("Text file busy");
      if (!retryable || i === attempts - 1) break;
      await sleep(100 * (i + 1) + Math.floor(Math.random() * 75));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Vercel 上で複数コレクターが同時に Chromium を起動すると、/tmp 配下の実行ファイル競合で
 * `spawn ETXTBSY` が発生することがあるため、起動処理を直列化する。
 */
export async function prewarmVercelChromiumExecutable(): Promise<void> {
  if (!isVercelRuntime()) return;
  await runSerializedOnVercel(async () => {
    await withVercelChromiumBootstrapLock(async () => {
      await resolveSparticuzExecutablePath();
    });
  });
}

/**
 * Vercel 本番では Playwright の同梱ブラウザが無いため @sparticuz/chromium を使う。
 * ローカルでは通常の Chromium を起動する。
 */
export async function launchChromiumForRuntime(opts: LaunchOpts = {}): Promise<Browser> {
  const pw = await importPlaywrightCore();
  const headless = opts.headless ?? true;

  if (isVercelRuntime()) {
    return await runSerializedOnVercel(async () => {
      return await withVercelChromiumBootstrapLock(async () => {
        // /tmp 容量逼迫で Chromium が即終了する事故を減らす。
        await cleanupVercelCollectTmpScratch();
        const executablePath = await resolveSparticuzExecutablePath();
        const chromiumMod = await import("@sparticuz/chromium");
        const chromium = chromiumMod.default ?? chromiumMod;
        const args = mergeChromiumArgs(
          chromium.args,
          mergeChromiumArgs(
            [...VERCEL_CHROMIUM_STABILITY_ARGS],
            mergeChromiumArgs([...VERCEL_CHROMIUM_LOW_DISK_ARGS], opts.extraArgs)
          )
        );
        return await launchWithRetries(() =>
          pw.chromium.launch({
            executablePath,
            args,
            headless,
            slowMo: opts.slowMoMs,
          })
        );
      });
    });
  }

  return await pw.chromium.launch({
    headless,
    slowMo: opts.slowMoMs,
    args: opts.extraArgs,
  });
}
