-- AlterTable
ALTER TABLE "OrchestratorRun" ADD COLUMN     "cancelledBySessionId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "predecessorSessionId" TEXT;

-- CreateTable
CREATE TABLE "OrchestratorRunCallback" (
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestratorRunCallback_pkey" PRIMARY KEY ("runId","sessionId")
);

-- CreateIndex
CREATE INDEX "OrchestratorRunCallback_sessionId_idx" ON "OrchestratorRunCallback"("sessionId");

-- CreateIndex
CREATE INDEX "Session_predecessorSessionId_idx" ON "Session"("predecessorSessionId");

-- AddForeignKey
ALTER TABLE "OrchestratorRunCallback" ADD CONSTRAINT "OrchestratorRunCallback_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OrchestratorRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

