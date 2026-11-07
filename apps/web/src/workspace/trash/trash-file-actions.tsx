import { useRefresh } from "@/lib/use-refresh";
import { emptyTrash } from "@/src/workspace/trash-moves";
import { Button } from "@staaash/ui/components/button";

export function EmptyTrashAction({ disabled }: { disabled: boolean }) {
  const refresh = useRefresh();
  return (
    <Button
      disabled={disabled}
      variant="destructive-outline"
      onClick={() => void emptyTrash(refresh)}
    >
      Empty trash
    </Button>
  );
}
