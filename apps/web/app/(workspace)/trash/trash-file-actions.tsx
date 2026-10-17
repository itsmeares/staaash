"use client";

import { EMPTY_TRASH_CONFIRM } from "@/app/dashboard-context-menu";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { confirmAction } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function EmptyTrashAction({ disabled }: { disabled: boolean }) {
  const emptyTrash = async () => {
    if (!(await confirmAction(EMPTY_TRASH_CONFIRM))) return;
    try {
      await submitStorageMutationPost({
        action: "/api/files/trash/clear",
        fields: { redirectTo: "/trash" },
        logicalAction: "trash-clear",
      });
      window.location.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Empty trash failed.",
      );
    }
  };
  return (
    <Button
      disabled={disabled}
      variant="destructive-outline"
      onClick={() => void emptyTrash()}
    >
      Empty trash
    </Button>
  );
}
