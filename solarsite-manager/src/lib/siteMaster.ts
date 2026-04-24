import { prisma } from "@/lib/prisma";

type SiteMasterSeed = {
  siteName: string;
  monitoringSystem: string;
  monitoringUrl: string;
  capacity: number;
  location: string;
};

const MONITORING_URL: Record<string, string> = {
  "eco-megane": "https://eco-megane.jp/",
  "fusion-solar": "https://jp5.fusionsolar.huawei.com/",
  "sunny-portal": "https://www.sunnyportal.com/Plants",
  "grand-arch": "https://grandarch.energymntr.com/",
  "solar-monitor-sf": "https://solar-monitor.solar-frontier.com/frontier/pg/hk/HJokyoPage.aspx",
  "solar-monitor-se": "https://solar-monitor.solar-energy.co.jp/ssm/pg/hk/HKMenuPage.aspx",
};

const SITE_MASTER_SEED: SiteMasterSeed[] = [
  { siteName: "長谷（低圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "川尻（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "池新田南（低圧）", monitoringSystem: "solar-monitor-sf", monitoringUrl: MONITORING_URL["solar-monitor-sf"], capacity: 100, location: "未設定" },
  { siteName: "沼津（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "白井（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "黒子②（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "白羽（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "まこと（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "松本②238-1HD（低圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "松本242（低圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "本社（低圧）", monitoringSystem: "solar-monitor-sf", monitoringUrl: MONITORING_URL["solar-monitor-sf"], capacity: 100, location: "未設定" },
  { siteName: "豊住（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "笠名IC（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "鉄塔敷地（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "湖西（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "西大渕（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "坂口（高圧）", monitoringSystem: "sunny-portal", monitoringUrl: MONITORING_URL["sunny-portal"], capacity: 100, location: "未設定" },
  { siteName: "落居（笠名高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "大塚（高圧）", monitoringSystem: "sunny-portal", monitoringUrl: MONITORING_URL["sunny-portal"], capacity: 100, location: "未設定" },
  { siteName: "笠名②（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "佐倉③（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "須山（高圧）", monitoringSystem: "solar-monitor-se", monitoringUrl: MONITORING_URL["solar-monitor-se"], capacity: 100, location: "未設定" },
  { siteName: "下和田（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "須山②（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "浜野（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "西方（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "合戸（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "佐倉（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "比木（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "静谷（高圧）", monitoringSystem: "grand-arch", monitoringUrl: MONITORING_URL["grand-arch"], capacity: 100, location: "未設定" },
  { siteName: "勝俣（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "細江（低圧）", monitoringSystem: "eco-megane", monitoringUrl: MONITORING_URL["eco-megane"], capacity: 100, location: "未設定" },
  { siteName: "合戸②（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
  { siteName: "高橋②（高圧）", monitoringSystem: "fusion-solar", monitoringUrl: MONITORING_URL["fusion-solar"], capacity: 100, location: "未設定" },
];

export async function ensureSiteMasterSeededIfEmpty(): Promise<void> {
  const count = await prisma.site.count();
  if (count > 0) return;

  for (const site of SITE_MASTER_SEED) {
    await prisma.site.create({
      data: {
        siteName: site.siteName,
        monitoringSystem: site.monitoringSystem,
        monitoringUrl: site.monitoringUrl,
        capacity: site.capacity,
        location: site.location,
      },
    });
  }
}
