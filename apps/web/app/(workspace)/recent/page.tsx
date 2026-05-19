import { getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { toRecentClientItem } from "./recent-helpers";
import { RecentView } from "./recent-view";

export const dynamic = "force-dynamic";

type RecentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecentPage({ searchParams }: RecentPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/recent"),
  ]);
  const allItems = await retrievalService.listRecentlyAdded({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <RecentView
      error={error}
      items={allItems.map(toRecentClientItem)}
      success={success}
    />
  );
}
