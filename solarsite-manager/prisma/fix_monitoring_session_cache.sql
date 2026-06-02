-- MonitoringSessionCache テーブルが（_prisma_migrations 上は適用済みでも）実体が無い場合の復旧用。
-- すべて IF NOT EXISTS で冪等。
CREATE TABLE IF NOT EXISTS "MonitoringSessionCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "sessionJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSessionCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MonitoringSessionCache_userId_systemId_key" ON "MonitoringSessionCache"("userId", "systemId");

CREATE INDEX IF NOT EXISTS "MonitoringSessionCache_systemId_idx" ON "MonitoringSessionCache"("systemId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MonitoringSessionCache_userId_fkey'
  ) THEN
    ALTER TABLE "MonitoringSessionCache"
      ADD CONSTRAINT "MonitoringSessionCache_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
