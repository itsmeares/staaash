import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { ShareErrorView, ShareView } from "@/app/s/share-view";
import { getShareBaseUrl } from "@/server/request";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { ShareError, isShareError } from "@/server/sharing/errors";
import { getSharePageMetadata } from "@/server/sharing/metadata";
import { getPublicShareFilePreview } from "@/server/sharing/public-file-preview";
import { sharingService } from "@/server/sharing/service";

export const dynamic = "force-dynamic";

type SharedRootPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: SharedRootPageProps): Promise<Metadata> {
  const [{ token }, h, cookieStore] = await Promise.all([
    params,
    headers(),
    cookies(),
  ]);

  return getSharePageMetadata({
    token,
    baseUrl: getShareBaseUrl(h),
    shareAccessCookieValue:
      cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
  });
}

export default async function SharedRootPage({
  params,
  searchParams,
}: SharedRootPageProps) {
  const [{ token }, resolvedSearchParams, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);

  try {
    const resolution = await sharingService.resolvePublicShare({
      token,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });
    const filePreview =
      resolution.kind === "file" && resolution.access.isUnlocked
        ? await getPublicShareFilePreview(resolution.file)
        : null;

    return (
      <ShareView
        filePreview={filePreview}
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
