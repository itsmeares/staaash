import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { getAdminJobEvents } from "@/server/admin/jobs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const { jobId } = await params;
  const events = await getAdminJobEvents(jobId);

  return NextResponse.json({
    items: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
