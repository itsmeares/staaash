import { Prisma } from "@staaash/db/client";
import {
  HEIC_NAME_PATTERN,
  VIEWER_MIME_PREFIXES,
} from "@staaash/config/media-types";

const viewerMimePattern = `^(${VIEWER_MIME_PREFIXES.map(([prefix]) => prefix).join("|")})`;

/** Matches the viewer's MIME-first recognition without rewriting stored metadata. */
export const fileMimeTypeSql = (mime: Prisma.Sql, name: Prisma.Sql) => {
  const normalized = Prisma.sql`btrim(split_part(lower(${mime}), ';', 1))`;
  return Prisma.sql`CASE
    WHEN ${normalized} ~ ${viewerMimePattern} THEN ${normalized}
    WHEN lower(${name}) ~ ${HEIC_NAME_PATTERN} THEN 'image/heic'
    ELSE ${normalized} END`;
};
