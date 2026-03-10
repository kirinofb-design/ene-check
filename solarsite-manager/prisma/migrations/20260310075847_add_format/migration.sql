-- CreateTable
CREATE TABLE "CustomFormat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "monitoringSystem" TEXT NOT NULL,
    "siteId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomFormat_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CustomFormat_monitoringSystem_isActive_idx" ON "CustomFormat"("monitoringSystem", "isActive");

-- CreateIndex
CREATE INDEX "CustomFormat_siteId_isActive_idx" ON "CustomFormat"("siteId", "isActive");
