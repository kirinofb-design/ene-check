import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SiteEditForm } from "@/components/sites/SiteEditForm";

export default async function SiteEditPage({
  params,
}: {
  params: { siteId: string };
}) {
  const site = await prisma.site.findUnique({
    where: { id: params.siteId },
  });

  if (!site) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">サイト編集</h1>
        <Link
          href={`/sites/${site.id}`}
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          ← 詳細へ戻る
        </Link>
      </div>

      <SiteEditForm site={site} />
    </div>
  );
}
