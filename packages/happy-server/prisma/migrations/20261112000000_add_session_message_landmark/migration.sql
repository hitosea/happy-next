-- AlterTable
ALTER TABLE "SessionMessage" ADD COLUMN "landmark" TEXT;

-- CreateIndex
CREATE INDEX "SessionMessage_sessionId_landmark_seq_idx" ON "SessionMessage"("sessionId", "landmark", "seq");
