ALTER TABLE "AccountPushToken"
ADD COLUMN "installationId" TEXT;

CREATE INDEX "AccountPushToken_accountId_installationId_idx"
ON "AccountPushToken"("accountId", "installationId");
