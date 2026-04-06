// ts-node 実行環境（CJS）で確実に動かすため require を使用
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { parseFile } = require("../src/services/fileParser") as typeof import("../src/services/fileParser");

async function validateOne(filePath: string) {
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);

  // Node 20+ には File が存在（なければ undici 経由になるが、ここではグローバルを期待）
  const file = new File([buf], name, { type: "text/csv" });
  const result = await parseFile(file);

  return {
    name,
    totalRows: result.summary.totalRows,
    successCount: result.summary.successCount,
    errorCount: result.summary.errorCount,
    firstDate: result.data[0]?.date?.toISOString?.().slice(0, 10) ?? null,
    firstGeneration: result.data[0]?.generation ?? null,
  };
}

async function main() {
  const root = process.cwd();
  const sampleDir = path.join(root, "sample");

  const files = [
    "eco-megane_sample.csv",
    "fusion-solar_sample.csv",
    "sunny-portal_sample.csv",
    "grand-arch_sample.csv",
    "solar-monitor_sf_sample.csv",
    "solar-monitor_se_sample.csv",
  ].map((f) => path.join(sampleDir, f));

  for (const fp of files) {
    const r = await validateOne(fp);
    console.log(
      JSON.stringify(
        {
          file: r.name,
          totalRows: r.totalRows,
          successCount: r.successCount,
          errorCount: r.errorCount,
          firstDate: r.firstDate,
          firstGeneration: r.firstGeneration,
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

