import { cookies } from "next/headers";

import { ShareErrorView, ShareView } from "@/app/s/share-view";
import {
  SHARE_ACCESS_COOKIE_NAME,
  ShareError,
  isShareError,
  sharingService,
} from "@/server/sharing";

export const dynamic = "force-dynamic";

type SharedRootPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
    const resolution = await sharingService.resolvePublicShare({
      token,
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
