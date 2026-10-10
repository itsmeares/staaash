"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerPageSession } from "@/server/auth/guards";
import { retryStorageMutationNow } from "@staaash/db/storage-mutations";

export const retryStorageMutationAction = async (formData: FormData) => {
  await requireOwnerPageSession();
  const mutationId = formData.get("mutationId");
  if (typeof mutationId !== "string" || mutationId.length === 0) return;
  await retryStorageMutationNow(mutationId);
  revalidatePath("/admin/storage");
  revalidatePath("/admin");
};
