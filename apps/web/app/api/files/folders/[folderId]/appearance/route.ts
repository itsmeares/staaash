// Mutation routes intentionally share origin, auth, and response guards.
// fallow-ignore-file code-duplication
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";

const SWATCHES = [
  "stone",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

const appearanceSchema = z.object({
  color: z
    .union([z.enum(SWATCHES), z.string().regex(/^#[0-9a-f]{6}$/i), z.null()])
    .optional(),
  icon: z
    .string()
    .regex(/^[A-Za-z]{1,32}$/)
    .nullable()
    .optional(),
});

type RouteContext = { params: Promise<{ folderId: string }> };

/** Sets a folder's color and icon; send null to go back to the default. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }
  const session = await getRequestSession(request);
  if (!session) return notSignedInResponse(request, "/files");

  const parsed = appearanceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid color or icon." },
      { status: 400 },
    );
  }
  try {
    const folder = await filesService.setFolderAppearance({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      folderId: (await params).folderId,
      ...parsed.data,
    });
    return NextResponse.json({ color: folder.color, icon: folder.icon });
  } catch (error) {
    if (isFilesError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
