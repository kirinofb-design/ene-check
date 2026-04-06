import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// siteName → laplaceCode のマッピング（STEP1の結果から補完）
const MAPPING: Record<string, string> = {
  "下和田（高圧）": "J-043",
  "須山②（高圧）": "J-052",
  "松本②238-1HD（低圧）": "J-058",
  "長谷（低圧）": "J-051",
  "落居（笠名高圧）": "J-023",
  "静谷（高圧）": "J-047",
  "比木（高圧）": "J-044",
  "合戸（高圧）": "J-045",
  "笠名②（高圧）": "J-053",
  "西方（高圧）": "J-056",
  "松本242（低圧）": "J-057",
};

/** CSV は 1 コード 1 行のため、同一 laplaceCode を複数 Site に付けるとコレクターは先頭 1 件にしか紐づかない */
const CLEAR_LAPLACE_SITE_NAMES = ["須山（高圧）", "笠名IC（低圧）"];

async function main() {
  for (const siteName of CLEAR_LAPLACE_SITE_NAMES) {
    const result = await prisma.site.updateMany({
      where: { siteName },
      data: { laplaceCode: null },
    });
    console.log(`${siteName}: laplaceCode クリア ${result.count} 件`);
  }

  for (const [siteName, laplaceCode] of Object.entries(MAPPING)) {
    const result = await prisma.site.updateMany({
      where: { siteName },
      data: { laplaceCode },
    });
    console.log(`${siteName} → ${laplaceCode}: ${result.count} updated`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
