-- Recent shows what someone last did with an item ("Uploaded", "Renamed").
-- Rows recorded before this keep an empty action and show only their time.
CREATE TYPE "RecentAction" AS ENUM (
  'opened',
  'uploaded',
  'created',
  'renamed',
  'moved',
  'downloaded',
  'trashed',
  'restored'
);

ALTER TABLE "RecentFile" ADD COLUMN "lastAction" "RecentAction";
ALTER TABLE "RecentFolder" ADD COLUMN "lastAction" "RecentAction";

-- Pinned favorites can also be listed in the sidebar. Off by default.
ALTER TABLE "UserPreference"
  ADD COLUMN "showPinsInSidebar" BOOLEAN NOT NULL DEFAULT false;
