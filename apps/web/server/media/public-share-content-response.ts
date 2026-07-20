import type { StoredFile } from "@/server/files/types";
import { ShareError } from "@/server/sharing/errors";

import {
  createInlineContentResponse,
  createReadyDerivativeContentResponse,
} from "./derivative-content-response";
import {
  applyPublicShareContentPolicy,
  getPublicShareResponseMimeType,
  isPublicShareResponseAttachment,
} from "./public-share-content-policy";

const applyAndEnforcePublicShareContentPolicy = async ({
  response,
  fileName,
  downloadDisabled,
}: {
  response: Response;
  fileName: string;
  downloadDisabled: boolean;
}): Promise<Response> => {
  const publicResponse = applyPublicShareContentPolicy(response, fileName);

  if (downloadDisabled && isPublicShareResponseAttachment(publicResponse)) {
    try {
      await publicResponse.body?.cancel();
    } finally {
      throw new ShareError("SHARE_DOWNLOAD_DISABLED");
    }
  }

  return publicResponse;
};

export const createPublicShareContentResponse = async ({
  request,
  file,
  downloadDisabled,
}: {
  request: Request;
  file: StoredFile;
  downloadDisabled: boolean;
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

  return applyAndEnforcePublicShareContentPolicy({
    response,
    fileName: file.name,
    downloadDisabled,
  });
};

export const createPublicReadyDerivativeContentResponse = async (
  input: Parameters<typeof createReadyDerivativeContentResponse>[0] & {
    downloadDisabled: boolean;
  },
): Promise<Response> => {
  const { downloadDisabled, ...responseInput } = input;
  const response = await createReadyDerivativeContentResponse({
    ...responseInput,
    derivative: {
      ...responseInput.derivative,
      mimeType: getPublicShareResponseMimeType(
        responseInput.derivative.mimeType ?? "application/octet-stream",
      ),
    },
  });
  return applyAndEnforcePublicShareContentPolicy({
    response,
    fileName: responseInput.fileName,
    downloadDisabled,
  });
};
