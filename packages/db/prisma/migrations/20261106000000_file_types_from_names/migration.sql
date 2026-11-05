BEGIN;

-- Uploads that sent no type, like every desktop upload, were stored as generic
-- files and opened as downloads. Give them the type uploads now get from the
-- file name. Only the label changes; stored bytes and paths stay as they are.
CREATE TEMP TABLE staaash_extension_types (extension TEXT PRIMARY KEY, mime TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO staaash_extension_types VALUES
  ('heic', 'image/heic'), ('heif', 'image/heif'), ('avif', 'image/avif'),
  ('bmp', 'image/bmp'), ('gif', 'image/gif'), ('jpeg', 'image/jpeg'),
  ('jpg', 'image/jpeg'), ('png', 'image/png'), ('webp', 'image/webp'),
  ('avi', 'video/x-msvideo'), ('m4v', 'video/mp4'), ('mkv', 'video/x-matroska'),
  ('mov', 'video/quicktime'), ('mp4', 'video/mp4'), ('ogv', 'video/ogg'),
  ('webm', 'video/webm'), ('aac', 'audio/aac'), ('flac', 'audio/flac'),
  ('m4a', 'audio/mp4'), ('mp3', 'audio/mpeg'), ('oga', 'audio/ogg'),
  ('ogg', 'audio/ogg'), ('opus', 'audio/ogg'), ('wav', 'audio/wav'),
  ('pdf', 'application/pdf'), ('csv', 'text/csv'), ('log', 'text/plain'),
  ('md', 'text/markdown'), ('txt', 'text/plain');

-- A fixed label is not an edit, so folder modified dates stay put.
ALTER TABLE "File" DISABLE TRIGGER "File_update_folder_dates";
UPDATE "File" file SET "mimeType" = types.mime
FROM staaash_extension_types types
WHERE btrim(split_part(lower(file."mimeType"), ';', 1)) IN ('', 'application/octet-stream')
  AND lower(substring(file."originalName" FROM '\.([^.]+)$')) = types.extension;
ALTER TABLE "File" ENABLE TRIGGER "File_update_folder_dates";

-- Uploads still in progress commit with their session's type.
UPDATE "UploadSession" session SET "mimeType" = types.mime
FROM staaash_extension_types types
WHERE btrim(split_part(lower(session."mimeType"), ';', 1)) IN ('', 'application/octet-stream')
  AND lower(substring(session."originalName" FROM '\.([^.]+)$')) = types.extension;

COMMIT;
