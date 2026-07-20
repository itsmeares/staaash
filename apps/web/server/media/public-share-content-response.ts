import type { StoredFile } from "@/server/files/types";

import {
  createInlineContentResponse,
  createReadyDerivativeContentResponse,
} from "./derivative-content-response";
import {
  applyPublicShareContentPolicy,
  getPublicShareResponseMimeType,
} from "./public-share-content-policy";

export const createPublicShareContentResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredFile;
}): Promise<Response> => {
  const publicFile = {
    ...file,
    mimeType: getPublicShareResponseMimeType(file.mimeType),
    viewerKind: file.viewerKind ?? ("text" as const),
  };
  const response = await createInlineContentResponse({
    request,
    file: publicFile,
  });

  return applyPublicShareContentPolicy(response, file.name);
};

export const createPublicReadyDerivativeContentResponse = async (
  input: Parameters<typeof createReadyDerivativeContentResponse>[0],
): Promise<Response> => {
  const response = await createReadyDerivativeContentResponse({
    ...input,
    derivative: {
      ...input.derivative,
      mimeType: getPublicShareResponseMimeType(
        input.derivative.mimeType ?? "application/octet-stream",
      ),
    },
  });
  return applyPublicShareContentPolicy(response, input.fileName);
};
