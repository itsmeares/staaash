import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@staaash/db/client";
import { scheduleDerivativeGenerate } from "@staaash/db/media-derivatives";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/http";
import { getSystemSettings } from "@/server/settings";
import { getPrivatePreviewStatus } from "@/server/files/derivative-status";

type RouteContext = {
  params: Promise<{ fileId: string }>;
};

const getAuthorizedFile = async (request: NextRequest, fileId: string) => {
  const session = await getRequestSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = getPrisma();
  const file = await db.file.findFirst({
    where: { id: fileId, deletedAt: null },
    select: { ownerUserId: true, mimeType: true },
  });
  if (
    !file ||
    !canAccessPrivateNamespace({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  return file;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  try {
    const file = await getAuthorizedFile(request, fileId);
    if (file instanceof Response) return file;

    return NextResponse.json(await getPrivatePreviewStatus(fileId));
  } catch {
    return NextResponse.json(
      { error: "Preview status unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const { fileId } = await params;
  try {
    const file = await getAuthorizedFile(request, fileId);
    if (file instanceof Response) return file;

    if (!file.mimeType.startsWith("video/")) {
      return NextResponse.json(
        { error: "Preview generation is only supported for video files." },
        { status: 400 },
      );
    }

    const settings = await getSystemSettings();
    if (!settings.mediaPreviewEnabled) {
      return NextResponse.json(
        { error: "Media previews are disabled." },
        { status: 409 },
      );
    }

    const { job } = await scheduleDerivativeGenerate({
      fileId,
      reason: "manual-regenerate",
    });
    return NextResponse.json({
      status: job.status === "running" ? "processing" : "queued",
      generatedAt: null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to queue preview." },
      { status: 503 },
    );
  }
}
