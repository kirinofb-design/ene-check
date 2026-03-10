import { config } from "dotenv";

// .env の後に .env.local を読み、DATABASE_URL 等をローカルで上書き
config();
config({ path: ".env.local", override: true });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
