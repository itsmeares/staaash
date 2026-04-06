import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import {
  ShareErrorView,
  ShareFilePage,
  ShareLockedView,
} from "@/app/s/share-view";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { ShareError, isShareError } from "@/server/sharing/errors";
import { sharingService } from "@/server/sharing/service";

export const dynamic = "force-dynamic";

type SharedNestedFilePageProps = {
  params: Promise<{
    token: string;
    fileId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharedNestedFilePage({
  params,
  searchParams,
}: SharedNestedFilePageProps) {
  const [{ token, fileId }, resolvedSearchParams, cookieStore] =
    await Promise.all([params, searchParams, cookies()]);
  const shareAccessCookieValue =
    cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null;

  try {
    const resolution = await sharingService.resolvePublicShare({
      token,
      shareAccessCookieValue,
    });

    if (resolution.kind !== "folder") {
      return <ShareErrorView error={new ShareError("SHARE_ACCESS_DENIED")} />;
    }

    if (resolution.access.requiresPassword && !resolution.access.isUnlocked) {
      return (
        <ShareLockedView
          error={(resolvedSearchParams.error as string | undefined) ?? null}
          redirectPath={`/s/${encodeURIComponent(token)}/files/${fileId}`}
          success={(resolvedSearchParams.success as string | undefined) ?? null}
          token={token}
        />
      );
    }

    const { file } = await sharingService.getSharedNestedFileContent({
      token,
      fileId,
      shareAccessCookieValue,
    });

    if (!file.viewerKind) {
      notFound();
    }

    const backHref =
      file.folderId === resolution.listing.rootFolder.id
        ? `/s/${encodeURIComponent(token)}`
        : `/s/${encodeURIComponent(token)}/f/${file.folderId}`;

    return (
      <ShareFilePage
        backHref={backHref}
        backLabel="Back to folder"
        contentHref={`/s/${encodeURIComponent(token)}/files/${file.id}/content`}
        downloadHref={`/s/${encodeURIComponent(token)}/files/${file.id}/download`}
        file={file}
        headerLabel="Shared file"
        searchParams={resolvedSearchParams}
        share={resolution.share}
      />
    );
  } catch (error) {
    if (isShareError(error)) {
      return <ShareErrorView error={error} />;
    }

    return <ShareErrorView error={new ShareError("SHARE_INVALID")} />;
  }
}
