-- AlterTable
ALTER TABLE "OrchestratorRun" ADD COLUMN "reopenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrchestratorExecution" ADD COLUMN "controllerSessionId" TEXT;

-- CreateIndex
CREATE INDEX "OrchestratorExecution_controllerSessionId_idx" ON "OrchestratorExecution"("controllerSessionId");

-- AddForeignKey
ALTER TABLE "OrchestratorExecution" ADD CONSTRAINT "OrchestratorExecution_controllerSessionId_fkey" FOREIGN KEY ("controllerSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
