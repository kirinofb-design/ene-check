const { spawn } = require("node:child_process");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, fn, retries = 3) {
  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        const waitMs = 1500 * i;
        console.warn(`[build] ${label} failed (${i}/${retries}), retrying in ${waitMs}ms`);
        await sleep(waitMs);
      }
    }
  }
  throw lastErr;
}

async function main() {
  await retry("prisma migrate deploy", () => run("npx", ["prisma", "migrate", "deploy"]), 4);
  await retry("prisma generate", () => run("npx", ["prisma", "generate"]), 3);
  await run("npx", ["next", "build"]);
}

main().catch((err) => {
  console.error("[build] failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
