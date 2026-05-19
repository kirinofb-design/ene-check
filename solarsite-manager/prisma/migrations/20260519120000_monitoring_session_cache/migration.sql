-- CreateTable
CREATE TABLE "MonitoringSessionCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "sessionJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringSessionCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSessionCache_userId_systemId_key" ON "MonitoringSessionCache"("userId", "systemId");

-- CreateIndex
CREATE INDEX "MonitoringSessionCache_systemId_idx" ON "MonitoringSessionCache"("systemId");

-- AddForeignKey
ALTER TABLE "MonitoringSessionCache" ADD CONSTRAINT "MonitoringSessionCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
