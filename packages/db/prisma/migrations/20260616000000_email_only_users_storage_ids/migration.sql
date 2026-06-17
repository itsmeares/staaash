-- Move Staaash from username/role/invite-link auth to email-only accounts,
-- stable storage IDs, owner/admin flags, and immediate temporary passwords.

ALTER TABLE "SystemSettings"
  DROP COLUMN IF EXISTS "inviteMaxAgeDays",
  DROP COLUMN IF EXISTS "passwordResetMaxAgeHours";

ALTER TABLE "Session"
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "storageId" TEXT,
  ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangeRequiredAt" TIMESTAMP(3),
  ADD COLUMN "temporaryPasswordIssuedAt" TIMESTAMP(3),
  ADD COLUMN "temporaryPasswordIssuedByUserId" TEXT;

WITH storage_base AS (
  SELECT
    "id",
    "role",
    COALESCE(
      NULLIF(
        trim(
          BOTH '.-' FROM regexp_replace(
            lower(split_part("email", '@', 1)),
            '[^a-z0-9._-]+',
            '-',
            'g'
          )
        ),
        ''
      ),
      'user'
    ) AS "baseStorageId",
    "createdAt"
  FROM "User"
),
numbered_storage AS (
  SELECT
    "id",
    "role",
    "baseStorageId",
    row_number() OVER (
      PARTITION BY "baseStorageId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "storageOrdinal"
  FROM storage_base
)
UPDATE "User" AS target_user
SET
  "storageId" = CASE
    WHEN numbered_storage."storageOrdinal" = 1
      THEN numbered_storage."baseStorageId"
    ELSE numbered_storage."baseStorageId" || '-' || substr(md5(numbered_storage."id"), 1, 6)
  END,
  "isOwner" = (numbered_storage."role" = 'owner'::"UserRole"),
  "isAdmin" = (numbered_storage."role" = 'owner'::"UserRole")
FROM numbered_storage
WHERE target_user."id" = numbered_storage."id"
  AND target_user."storageId" IS NULL;

ALTER TABLE "User"
  ALTER COLUMN "storageId" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "_UserStorageMigration" (
  "userId" TEXT PRIMARY KEY,
  "oldUsername" TEXT NOT NULL,
  "storageId" TEXT NOT NULL,
  "migratedAt" TIMESTAMP(3)
);

INSERT INTO "_UserStorageMigration" ("userId", "oldUsername", "storageId")
SELECT "id", "username", "storageId" FROM "User"
ON CONFLICT ("userId") DO UPDATE
SET
  "oldUsername" = EXCLUDED."oldUsername",
  "storageId" = EXCLUDED."storageId";

DROP TABLE IF EXISTS "Invite";
DROP TABLE IF EXISTS "PasswordReset";

DROP INDEX IF EXISTS "User_username_key";

ALTER TABLE "User"
  DROP COLUMN "username",
  DROP COLUMN "role";

DROP TYPE IF EXISTS "UserRole";

CREATE UNIQUE INDEX "User_storageId_key" ON "User"("storageId");
CREATE INDEX "User_isOwner_idx" ON "User"("isOwner");
CREATE INDEX "User_isAdmin_idx" ON "User"("isAdmin");
