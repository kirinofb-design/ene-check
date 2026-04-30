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

async function cleanupPlaywrightTmpProfiles(): Promise<void> {
  const dir = tmpdir();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) return;

  const now = Date.now();
  const staleAgeMs = 30 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("playwright_chromiumdev_profile-")) continue;
    const fullPath = join(dir, entry.name);
    const st = await stat(fullPath).catch(() => null);
    if (!st) continue;
    if (now - st.mtimeMs < staleAgeMs) continue;
    await rm(fullPath, { recursive: true, force: true }).catch(() => {});
  }
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
        await cleanupPlaywrightTmpProfiles();
        const executablePath = await resolveSparticuzExecutablePath();
        const chromiumMod = await import("@sparticuz/chromium");
        const chromium = chromiumMod.default ?? chromiumMod;
        const args = mergeChromiumArgs(chromium.args, opts.extraArgs);
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
