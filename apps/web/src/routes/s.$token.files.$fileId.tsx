import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { sharedFileQuery } from "@/src/queries";
import {
  ShareErrorView,
  ShareFilePage,
  ShareLockedView,
} from "@/src/share/share-view";
import { throwIfStorageBusy } from "@/src/share/storage-busy";

function SharedFilePage() {
  const { token, fileId } = Route.useParams();
  const { data } = useSuspenseQuery(sharedFileQuery(token, fileId));
  if (data.kind === "error") return <ShareErrorView error={data.error} />;
  if (data.kind === "locked") return <ShareLockedView token={token} />;
  if (data.kind === "not-found") throw notFound();
  return (
    <ShareFilePage
      backHref={data.backHref}
      backLabel="Back to folder"
      contentHref={data.contentHref}
      downloadHref={data.downloadHref}
      file={data.file}
      nativeInline={data.nativeInline}
      share={data.share}
    />
  );
}

export const Route = createFileRoute("/s/$token/files/$fileId")({
  loader: async ({ context, params: { token, fileId } }) => {
    try {
      await context.queryClient.ensureQueryData(sharedFileQuery(token, fileId));
    } catch (error) {
      throwIfStorageBusy(
        error,
        token,
        `/s/${encodeURIComponent(token)}/files/${fileId}`,
        { fileId },
      );
      throw error;
    }
  },
  component: SharedFilePage,
});
