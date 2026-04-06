import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targetSiteName = "須山（高圧）";
  const targetMonitoringSystem = "solar-monitor";

  const before = await prisma.site.findFirst({
    where: { siteName: targetSiteName },
    select: { id: true, siteName: true, monitoringSystem: true, monitoringUrl: true },
  });

  if (!before) {
    console.log(`Site not found: ${targetSiteName}`);
    return;
  }

  const updated = await prisma.site.update({
    where: { id: before.id },
    data: { monitoringSystem: targetMonitoringSystem },
    select: { id: true, siteName: true, monitoringSystem: true, monitoringUrl: true, updatedAt: true },
  });

  console.log("Updated site:");
  console.log(updated);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
