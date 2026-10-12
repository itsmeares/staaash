-- Folder color and icon live with the folder, so they follow it to every
-- device. Icons used to be kept only in one browser's localStorage.
ALTER TABLE "Folder"
  ADD COLUMN "color" TEXT,
  ADD COLUMN "icon" TEXT;

-- Personal preferences behind Settings: photos peeking out of folders, the
-- page Staaash opens on, list or grid by default, and the clock format.
ALTER TABLE "UserPreference"
  ADD COLUMN "showFolderPreviews" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "startPage" TEXT NOT NULL DEFAULT 'files',
  ADD COLUMN "defaultView" TEXT NOT NULL DEFAULT 'list',
  ADD COLUMN "clockFormat" TEXT NOT NULL DEFAULT '24h';
