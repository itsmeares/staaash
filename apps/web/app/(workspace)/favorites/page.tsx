import { requireSignedInPageSession } from "@/server/auth/guards";

import { PlaceholderPage } from "../placeholder-page";

export default async function FavoritesPage() {
  await requireSignedInPageSession("/sign-in?next=/favorites");

  return (
    <PlaceholderPage
      description="Favorites become functional in Phase 5. For now this route exists as a stable shell destination, not a fake implementation."
      eyebrow="Favorites"
      title="Favorites is reserved"
    />
  );
}
