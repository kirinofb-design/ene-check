import { config as loadEnv } from "dotenv";
import { resolve } from "path";
// Next.js と同様: .env → .env.local（後者が優先）
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../.env.local"), override: true });
import { PrismaClient } from "@prisma/client";
import { runLaplaceCollector } from "@/lib/laplaceCollector";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    });
    if (!user) throw new Error("user not found");

    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.max(1, now.getUTCDate() - 1)));
    const start = new Date(end);
    start.setUTCDate(Math.max(1, end.getUTCDate() - 2));

    console.log("[test-laplace] user", user.email, user.id);
    console.log("[test-laplace] range", ymd(start), ymd(end));

    const result = await runLaplaceCollector(user.id, ymd(start), ymd(end));
    console.log("[test-laplace] result", JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[test-laplace] failed", e);
  process.exit(1);
});
