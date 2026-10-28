import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { shareQuery } from "@/src/queries";
import { ShareErrorView, ShareView } from "@/src/share/share-view";
import { throwIfStorageBusy } from "@/src/share/storage-busy";

function SharedFolderPage() {
  const { token, folderId } = Route.useParams();
  const { data } = useSuspenseQuery(shareQuery(token, folderId));
  if (data.kind === "error") return <ShareErrorView error={data.error} />;
  return (
    <ShareView
      folderSizeBytes={data.folderSizeBytes}
      nativeInline={data.nativeInline}
      resolution={data.resolution}
      token={token}
    />
  );
}

export const Route = createFileRoute("/s/$token/f/$folderId")({
  loader: async ({ context, params: { token, folderId } }) => {
    try {
      await context.queryClient.ensureQueryData(shareQuery(token, folderId));
    } catch (error) {
      throwIfStorageBusy(
        error,
        token,
        `/s/${encodeURIComponent(token)}/f/${folderId}`,
        { folderId },
      );
      throw error;
    }
  },
  component: SharedFolderPage,
});
