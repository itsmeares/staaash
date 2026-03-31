import { requireSignedInPageSession } from "@/server/auth/guards";

import { PlaceholderPage } from "../placeholder-page";

export default async function SharedPage() {
  await requireSignedInPageSession("/sign-in?next=/shared");

  return (
    <PlaceholderPage
      description="Shared will become the public-link management surface once Phase 4 lands. In Phase 2 it stays an honest placeholder."
      eyebrow="Shared"
      title="Shared is reserved"
    />
  );
}
