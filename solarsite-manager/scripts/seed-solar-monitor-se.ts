import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/encryption";

const prisma = new PrismaClient();

async function main() {
  // --- Site 登録 ---
  const site = await prisma.site.upsert({
    where: { id: "solar-monitor-se-suzono" },
    update: {},
    create: {
      id: "solar-monitor-se-suzono",
      siteName: "裾野（低圧）",
      location: "静岡県裾野市須山1437-1",
      capacity: 599.76,
      monitoringSystem: "solar-monitor",
      monitoringUrl: "https://solar-monitor.solar-energy.co.jp/ssm/pg/LoginPage.aspx",
    },
  });
  console.log("Site upserted:", site.siteName);

  // --- MonitoringCredential 登録 ---
  // userId・loginId・password は環境変数から取得
  const userId = process.env.SEED_USER_ID;
  const loginId = process.env.SEED_LOGIN_ID;
  const password = process.env.SEED_PASSWORD;

  if (!userId || !loginId || !password) {
    console.log("SEED_USER_ID / SEED_LOGIN_ID / SEED_PASSWORD が未設定のためCredential登録をスキップ");
    return;
  }

  const cred = await prisma.monitoringCredential.upsert({
    where: { userId_systemId: { userId, systemId: "solar-monitor-se" } },
    update: { loginId, encryptedPassword: encryptSecret(password) },
    create: {
      userId,
      systemId: "solar-monitor-se",
      loginId,
      encryptedPassword: encryptSecret(password),
    },
  });
  console.log("MonitoringCredential upserted:", cred.systemId, cred.loginId);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
