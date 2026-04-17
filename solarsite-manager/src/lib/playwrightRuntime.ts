import type { Browser } from "playwright-core";

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

/**
 * Vercel 本番では Playwright の同梱ブラウザが無いため @sparticuz/chromium を使う。
 * ローカルでは通常の Chromium を起動する。
 */
export async function launchChromiumForRuntime(opts: LaunchOpts = {}): Promise<Browser> {
  const pw = await importPlaywrightCore();
  const headless = opts.headless ?? true;

  if (isVercelRuntime()) {
    const chromiumMod = await import("@sparticuz/chromium");
    const chromium = chromiumMod.default ?? chromiumMod;
    const executablePath = await chromium.executablePath();
    const args = mergeChromiumArgs(chromium.args, opts.extraArgs);
    return await pw.chromium.launch({
      executablePath,
      args,
      headless,
      slowMo: opts.slowMoMs,
    });
  }

  return await pw.chromium.launch({
    headless,
    slowMo: opts.slowMoMs,
    args: opts.extraArgs,
  });
}
