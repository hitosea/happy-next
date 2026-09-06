ALTER TABLE "AccountPushToken"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'expo';

UPDATE "AccountPushToken"
SET "provider" = CASE
  WHEN "token" LIKE 'ExponentPushToken[%'
    OR "token" LIKE 'ExpoPushToken[%'
  THEN 'expo'
  ELSE 'doopush'
END;
