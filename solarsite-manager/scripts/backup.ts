import fs from "fs";
import path from "path";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFileIfExists(src: string, dest: string) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${src} -> ${dest}`);
  } else {
    console.warn(`Skip (not found): ${src}`);
  }
}

function main() {
  const projectRoot = process.cwd();
  const backupRoot = path.join(projectRoot, "backups");
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const destDir = path.join(backupRoot, timestamp);
  ensureDir(destDir);

  // SQLite DB
  const dbSrc = path.join(projectRoot, "prisma", "dev.db");
  const dbDest = path.join(destDir, "dev.db");
  copyFileIfExists(dbSrc, dbDest);

  // uploads ディレクトリ（存在すれば再帰コピー）
  const uploadsSrc = path.join(projectRoot, "uploads");
  const uploadsDest = path.join(destDir, "uploads");
  if (fs.existsSync(uploadsSrc)) {
    ensureDir(uploadsDest);
    const entries = fs.readdirSync(uploadsSrc, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(uploadsSrc, entry.name);
      const destPath = path.join(uploadsDest, entry.name);
      if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
    console.log(`Copied uploads -> ${uploadsDest}`);
  } else {
    console.warn("Skip uploads backup (uploads directory not found).");
  }

  console.log(`Backup completed: ${destDir}`);
}

main();

