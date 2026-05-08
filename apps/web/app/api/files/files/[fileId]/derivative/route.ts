import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@staaash/db/client";
import { scheduleDerivativeGenerate } from "@staaash/db/media-derivatives";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/http";

type RouteContext = {
  params: Promise<{ fileId: string }>;
};

const getAuthorizedFile = async (
  fileId: string,
  actorId: string,
  actorRole: string,
) => {
  const db = getPrisma();
  const file = await db.file.findFirst({
    where: { id: fileId, deletedAt: null },
    select: { ownerUserId: true, mimeType: true },
  });
  if (!file) return null;
  if (file.ownerUserId !== actorId && actorRole !== "owner") return null;
  return file;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const file = await getAuthorizedFile(
    fileId,
    session.user.id,
    session.user.role,
  );
  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const db = getPrisma();
  const derivative = await db.mediaDerivative.findFirst({
    where: { fileId },
    select: { status: true, generatedAt: true },
  });

  if (!derivative) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    status: derivative.status,
    generatedAt: derivative.generatedAt?.toISOString() ?? null,
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const { fileId } = await params;
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const file = await getAuthorizedFile(
    fileId,
    session.user.id,
    session.user.role,
  );
  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  if (!file.mimeType.startsWith("video/")) {
    return NextResponse.json(
      { error: "Preview generation is only supported for video files." },
      { status: 400 },
    );
  }

  await scheduleDerivativeGenerate({ fileId, reason: "manual-regenerate" });

  return NextResponse.json({ status: "queued" });
}
