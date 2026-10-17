import { MissingPage } from "@/components/public/missing-page";
import { getCurrentSession } from "@/server/auth/session";

import { NotFoundActions } from "./not-found-actions";

export default async function WorkspaceNotFound() {
  const session = await getCurrentSession();
  if (!session) return <MissingPage />;
  return (
    <div className="grid min-h-[60dvh] place-content-center justify-items-center gap-4 text-center">
      <h1 className="m-0 font-heading text-headline font-semibold">
        This page doesn&apos;t exist
      </h1>
      <NotFoundActions />
    </div>
  );
}
