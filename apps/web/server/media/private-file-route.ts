import { FilesError } from "@/server/files/errors";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import type { Session } from "@/server/http/core";
import {
  createStorageEntityUnavailableResponse,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

type PrivateFile = Awaited<ReturnType<typeof getAccessiblePrivateFile>>;

/**
 * Serves one of the signed-in user's files: checks access, then maps storage,
 * files and media errors to responses.
 */
export async function respondWithPrivateFile({
  session,
  fileId,
  unavailable,
  respond,
}: {
  session: Session;
  fileId: string;
  unavailable: string;
  respond: (file: PrivateFile) => Promise<Response>;
}) {
  try {
    const file = await getAccessiblePrivateFile({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      fileId,
    });
    return await respond(file);
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      return createStorageEntityUnavailableResponse(error);
    }
    if (error instanceof FilesError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }
    return Response.json({ error: unavailable }, { status: 404 });
  }
}
