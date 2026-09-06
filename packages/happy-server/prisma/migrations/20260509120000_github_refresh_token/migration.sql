-- AlterTable
ALTER TABLE "GithubUser" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "refreshToken" BYTEA;
