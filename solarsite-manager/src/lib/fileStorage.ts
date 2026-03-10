import fs from "fs";
import path from "path";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

export async function saveFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const safeName = `${Date.now()}-${file.name}`;
  const filePath = path.join(uploadDir, safeName);

  fs.writeFileSync(filePath, buffer);

  return filePath;
}

