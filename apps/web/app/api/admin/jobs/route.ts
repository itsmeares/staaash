import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@staaash/db/client";
import { MEDIA_DERIVATIVE_GENERATE_JOB_KIND } from "@staaash/db/jobs";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminJobList,
  parseAdminJobFilters,
  toJsonAdminJobListResponse,
} from "@/server/admin/jobs";

export async function GET(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  const filters = parseAdminJobFilters({
    status: request.nextUrl.searchParams.get("status"),
    kind: request.nextUrl.searchParams.get("kind"),
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: request.nextUrl.searchParams.get("limit"),
    page: request.nextUrl.searchParams.get("page"),
  });

  const jobList = await getAdminJobList(filters);
  const response = toJsonAdminJobListResponse(jobList);

  const derivativeItems = response.items.filter(
    (j) => j.kind === MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
  );

  if (derivativeItems.length > 0) {
    const fileIds = derivativeItems
      .map((j) => (j.payloadJson as { fileId?: string } | null)?.fileId)
      .filter((id): id is string => Boolean(id));

    if (fileIds.length > 0) {
      const db = getPrisma();
      const files = await db.file.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, originalName: true },
      });
      const fileNameMap = new Map(files.map((f) => [f.id, f.originalName]));

      return NextResponse.json({
        ...response,
        items: response.items.map((job) => {
          if (job.kind !== MEDIA_DERIVATIVE_GENERATE_JOB_KIND) return job;
          const fileId = (job.payloadJson as { fileId?: string } | null)
            ?.fileId;
          return {
            ...job,
            fileName: fileId ? (fileNameMap.get(fileId) ?? null) : null,
          };
        }),
      });
    }
  }

  return NextResponse.json(response);
}
