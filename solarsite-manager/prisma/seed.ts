import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 開発用テストユーザー
  const passwordHash = await bcrypt.hash("Test1234", 10);

  const testUser = await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: {
      email: "test@example.com",
      name: "テストユーザー",
      password: passwordHash,
      role: "user",
    },
  });

  // Spec.md 11.1 / マスタープランの 6 サイト初期データ
  const sites = [
    {
      siteName: "Site-EcoMegane",
      monitoringSystem: "eco-megane",
      monitoringUrl: "https://eco-megane.jp/",
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "Site-Huawei",
      monitoringSystem: "fusion-solar",
      monitoringUrl: "https://jp5.fusionsolar.huawei.com/",
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "Site-SMA",
      monitoringSystem: "sunny-portal",
      monitoringUrl: "https://www.sunnyportal.com/",
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "Site-GrandArch",
      monitoringSystem: "grand-arch",
      monitoringUrl: "https://grandarch.energymntr.com/",
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "Site-SolarFrontier",
      monitoringSystem: "solar-monitor-sf",
      monitoringUrl: "https://solar-monitor.solar-frontier.com/",
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "Site-SolarEnergy",
      monitoringSystem: "solar-monitor-se",
      monitoringUrl: "https://solar-monitor.solar-energy.co.jp/",
      capacity: 100,
      location: "未設定",
    },
  ];

  for (const site of sites) {
    const existing = await prisma.site.findFirst({
      where: { siteName: site.siteName },
    });
    if (!existing) {
      await prisma.site.create({ data: site });
    }
  }

  console.log("Seed completed. User:", testUser.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

