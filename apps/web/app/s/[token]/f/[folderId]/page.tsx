import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { ShareErrorView, ShareView } from "@/app/s/share-view";
import { getShareBaseUrl } from "@/server/request";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { ShareError, isShareError } from "@/server/sharing/errors";
import { getSharePageMetadata } from "@/server/sharing/metadata";
import { sharingService } from "@/server/sharing/service";

export const dynamic = "force-dynamic";

type SharedFolderPageProps = {
  params: Promise<{
    token: string;
    folderId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: SharedFolderPageProps): Promise<Metadata> {
  const [{ token, folderId }, h, cookieStore] = await Promise.all([
    params,
    headers(),
    cookies(),
  ]);

  return getSharePageMetadata({
    token,
    folderId,
    baseUrl: getShareBaseUrl(h),
    shareAccessCookieValue:
      cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
  });
}

export default async function SharedFolderPage({
  params,
  searchParams,
}: SharedFolderPageProps) {
  const [{ token, folderId }, resolvedSearchParams, cookieStore] =
    await Promise.all([params, searchParams, cookies()]);

  try {
    const resolution = await sharingService.resolvePublicShare({
      token,
      requestedFolderId: folderId,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return (
      <ShareView
        resolution={resolution}
        searchParams={resolvedSearchParams}
        token={token}
      />
    );
  } catch (error) {
    if (isShareError(error)) {
      return <ShareErrorView error={error} />;
    }

    return <ShareErrorView error={new ShareError("SHARE_INVALID")} />;
  }
}
