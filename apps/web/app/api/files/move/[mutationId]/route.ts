import { NextRequest, NextResponse } from "next/server";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, jsonNotSignedInResponse } from "@/server/auth/http";
import { toBatchMoveOperationResponse } from "@/server/files/move-operation";
import { findStorageMutation } from "@staaash/db/storage-mutations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mutationId: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) return jsonNotSignedInResponse();

  const { mutationId } = await params;
  const mutation = await findStorageMutation(mutationId);
  if (
    !mutation ||
    mutation.kind !== "batch_move" ||
    mutation.parentId !== null ||
    !canAccessPrivateNamespace({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      namespaceOwnerUserId: mutation.ownerUserId,
    })
  ) {
    return NextResponse.json(
      { error: "Move operation not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(toBatchMoveOperationResponse(mutation), {
    headers: {
      "Cache-Control": "no-store",
      "X-Storage-Mutation-Id": mutation.id,
    },
  });
}
