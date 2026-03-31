import { requireSignedInPageSession } from "@/server/auth/guards";

import { PlaceholderPage } from "../placeholder-page";

export default async function RecentPage() {
  await requireSignedInPageSession("/sign-in?next=/recent");

  return (
    <PlaceholderPage
      description="Recent activity will land with the retrieval layer in Phase 5. The route is already real so the shell and information architecture stay stable."
      eyebrow="Recent"
      title="Recent is reserved"
    />
  );
}
