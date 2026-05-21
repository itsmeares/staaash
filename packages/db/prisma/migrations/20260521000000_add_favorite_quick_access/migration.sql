ALTER TABLE "FavoriteFile"
  ADD COLUMN "quickAccessPinnedAt" TIMESTAMP(3);

ALTER TABLE "FavoriteFolder"
  ADD COLUMN "quickAccessPinnedAt" TIMESTAMP(3);

CREATE INDEX "FavoriteFile_userId_quickAccessPinnedAt_idx"
  ON "FavoriteFile"("userId", "quickAccessPinnedAt");

CREATE INDEX "FavoriteFolder_userId_quickAccessPinnedAt_idx"
  ON "FavoriteFolder"("userId", "quickAccessPinnedAt");
