-- CreateTable
CREATE TABLE "MonitoringCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonitoringCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MonitoringCredential_systemId_idx" ON "MonitoringCredential"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringCredential_userId_systemId_key" ON "MonitoringCredential"("userId", "systemId");
