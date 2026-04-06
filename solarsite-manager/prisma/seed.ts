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

  // 発電所マスタ（34発電所）
  // monitoringSystem は内部ID（eco-megane / fusion-solar / sunny-portal / grand-arch / solar-monitor-sf / solar-monitor-se）
  const MONITORING_URL: Record<string, string> = {
    "eco-megane": "https://eco-megane.jp/",
    "fusion-solar": "https://jp5.fusionsolar.huawei.com/",
    "sunny-portal": "https://www.sunnyportal.com/Plants",
    "grand-arch": "https://grandarch.energymntr.com/",
    "solar-monitor-sf": "https://solar-monitor.solar-frontier.com/frontier/pg/hk/HJokyoPage.aspx",
    "solar-monitor-se": "https://solar-monitor.solar-energy.co.jp/ssm/pg/hk/HKMenuPage.aspx",
  };

  const sites = [
    {
      siteName: "長谷（低圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "川尻（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "池新田南（低圧）",
      monitoringSystem: "solar-monitor-sf",
      monitoringUrl: MONITORING_URL["solar-monitor-sf"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "沼津（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "白井（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "黒子②（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "白羽（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "まこと（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "松本②238-1HD（低圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "松本242（低圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "本社（低圧）",
      monitoringSystem: "solar-monitor-sf",
      monitoringUrl: MONITORING_URL["solar-monitor-sf"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "豊住（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "笠名IC（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "鉄塔敷地（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "湖西（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "西大渕（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "坂口（高圧）",
      monitoringSystem: "sunny-portal",
      monitoringUrl: MONITORING_URL["sunny-portal"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "落居（笠名高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "大塚（高圧）",
      monitoringSystem: "sunny-portal",
      monitoringUrl: MONITORING_URL["sunny-portal"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "笠名②（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "佐倉③（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "須山（高圧）",
      monitoringSystem: "solar-monitor-se",
      monitoringUrl: MONITORING_URL["solar-monitor-se"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "下和田（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "須山②（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "浜野（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "西方（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "合戸（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "佐倉（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "比木（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "静谷（高圧）",
      monitoringSystem: "grand-arch",
      monitoringUrl: MONITORING_URL["grand-arch"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "勝俣（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "細江（低圧）",
      monitoringSystem: "eco-megane",
      monitoringUrl: MONITORING_URL["eco-megane"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "合戸②（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
    {
      siteName: "高橋②（高圧）",
      monitoringSystem: "fusion-solar",
      monitoringUrl: MONITORING_URL["fusion-solar"],
      capacity: 100,
      location: "未設定",
    },
  ];

  const desiredSiteNames = sites.map((s) => s.siteName);

  for (const site of sites) {
    const existing = await prisma.site.findFirst({
      where: { siteName: site.siteName },
      select: { id: true },
    });
    if (existing) {
      await prisma.site.update({
        where: { id: existing.id },
        data: {
          monitoringSystem: site.monitoringSystem,
          monitoringUrl: site.monitoringUrl,
          capacity: site.capacity,
          location: site.location ?? null,
        },
      });
    } else {
      await prisma.site.create({ data: site });
    }
  }

  // リスト外の古いサイトを削除（関連データも先に削除）
  const obsoleteSites = await prisma.site.findMany({
    where: { siteName: { notIn: desiredSiteNames } },
    select: { id: true, siteName: true },
  });

  if (obsoleteSites.length > 0) {
    const obsoleteIds = obsoleteSites.map((s) => s.id);

    await prisma.dailyGeneration.deleteMany({
      where: { siteId: { in: obsoleteIds } },
    });
    await prisma.uploadHistory.deleteMany({
      where: { siteId: { in: obsoleteIds } },
    });
    await prisma.alert.deleteMany({
      where: { siteId: { in: obsoleteIds } },
    });
    await prisma.customFormat.deleteMany({
      where: { siteId: { in: obsoleteIds } },
    });

    await prisma.site.deleteMany({
      where: { id: { in: obsoleteIds } },
    });
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

