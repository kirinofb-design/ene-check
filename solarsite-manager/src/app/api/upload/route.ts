import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { saveFile } from "@/lib/fileStorage";
import { parseFile } from "@/services/fileParser";
import { checkAlerts } from "@/services/alertService";

export async function POST(request: Request) {
  try {
    const session = await requireAuth(request);
    const formData = await request.formData();

    const file = formData.get("file");
    const rawSiteId = formData.get("siteId") as string | null;
    const siteId = typeof rawSiteId === "string" && rawSiteId.trim() ? rawSiteId : null;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "ファイルが指定されていません。" } },
        { status: 400 }
      );
    }

    const filePath = await saveFile(file);

    const parseResult = await parseFile(file, siteId ?? undefined);

    let targetSiteId = "";
    await prisma.$transaction(async (tx) => {
      targetSiteId =
        siteId ??
        (await ensureSiteForUpload(tx, file.name)); // 将来的にサイト名推定を拡張

      for (const row of parseResult.data) {
        await tx.dailyGeneration.upsert({
          where: {
            siteId_date: {
              siteId: targetSiteId,
              date: row.date,
            },
          },
          update: {
            generation: row.generation,
            status: row.status ?? undefined,
            notes: row.notes ?? undefined,
          },
          create: {
            siteId: targetSiteId,
            date: row.date,
            generation: row.generation,
            status: row.status ?? undefined,
            notes: row.notes ?? undefined,
          },
        });
      }

      await tx.uploadHistory.create({
        data: {
          userId: (session.user as any).id,
          siteId: targetSiteId,
          fileName: file.name,
          filePath,
          fileSize: file.size,
          dataFormat: detectFormat(file.name),
          recordCount: parseResult.summary.totalRows,
          successCount: parseResult.summary.successCount,
          errorCount: parseResult.summary.errorCount,
        },
      });
    });

    if (targetSiteId) {
      await checkAlerts(targetSiteId);
    }

    return NextResponse.json({ data: parseResult });
  } catch (e) {
    return handleApiError(request, e);
  }
}

async function ensureSiteForUpload(
  tx: typeof prisma,
  fileName: string
): Promise<string> {
  // MVP では単純に既存サイトの先頭を利用し、なければ汎用サイトを1つ作る。
  const existing = await tx.site.findFirst();
  if (existing) return existing.id;

  const site = await tx.site.create({
    data: {
      siteName: `AutoSite-${fileName}`,
      capacity: 0,
      monitoringSystem: "unknown",
      monitoringUrl: "",
      location: "未設定",
    },
  });
  return site.id;
}

function detectFormat(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".csv")) return "csv";
  return "unknown";
}

