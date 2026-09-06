import { redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

import { StorageUnavailableView } from "./storage-unavailable-view";

export const dynamic = "force-dynamic";

type StorageUnavailablePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const getSingleSearchParam = (
  params: Record<string, string | string[] | undefined>,
  key: string,
) => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

export default async function StorageUnavailablePage({
  searchParams,
}: StorageUnavailablePageProps) {
  const session = await requireSignedInPageSession("/?next=/files");
  const folderId = getSingleSearchParam(await searchParams, "folderId");

  if (!folderId) redirect("/files");

  const folderPath = `/files/f/${encodeURIComponent(folderId)}`;

  try {
    const listing = await filesService.getFilesListing({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
    });

    if (listing.currentFolder.isFilesRoot) redirect("/files");
    redirect(folderPath);
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      return (
        <StorageUnavailableView
          recoveryRequired={error.code === "STORAGE_RECOVERY_REQUIRED"}
        />
      );
    }
    if (isFilesError(error)) {
      redirect(`/files?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}
