import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { ShareErrorView, ShareView } from "@/app/s/share-view";
import { getShareBaseUrl } from "@/server/request";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { ShareError, isShareError } from "@/server/sharing/errors";
import { getSharePageMetadata } from "@/server/sharing/metadata";
import { getPublicShareFilePreview } from "@/server/sharing/public-file-preview";
import { sharingService } from "@/server/sharing/service";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

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

const resolveSharedRoot = async (
  token: string,
  shareAccessCookieValue: string | null,
) => {
  const resolution = await sharingService.resolvePublicShare({
    token,
    shareAccessCookieValue,
  });
  const filePreview =
    resolution.kind === "file" && resolution.access.isUnlocked
      ? await getPublicShareFilePreview(resolution.file)
      : null;
  return { resolution, filePreview };
};

const sharedRootUnavailablePath = (token: string) => {
  const rootPath = `/s/${encodeURIComponent(token)}`;
  return `${rootPath}/storage-unavailable?returnTo=${encodeURIComponent(rootPath)}`;
};

const renderSharedRootError = (error: unknown, token: string) => {
  if (error instanceof StorageEntityUnavailableError) {
    redirect(sharedRootUnavailablePath(token));
  }
  return (
    <ShareErrorView
      error={isShareError(error) ? error : new ShareError("SHARE_INVALID")}
    />
  );
};

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
    const { resolution, filePreview } = await resolveSharedRoot(
      token,
      cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    );

    return (
      <ShareView
        filePreview={filePreview}
        resolution={resolution}
        searchParams={resolvedSearchParams}
        token={token}
      />
    );
  } catch (error) {
    return renderSharedRootError(error, token);
  }
}
