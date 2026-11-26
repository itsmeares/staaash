import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { api, read } from "@/lib/api";
import { recoveredNoticeQuery } from "@/src/queries";
import { toastManager } from "@staaash/ui/components/toast";

// Once per page load: React's development double effect must not toast twice.
let shown = false;

/**
 * Tells a person, once, about copies Staaash kept in their drive while it
 * fixed a change that had stopped. Show opens the folder and lights the copy.
 */
export function RecoveredNotice() {
  const navigate = useNavigate();
  const notice = useQuery(recoveredNoticeQuery).data;
  useEffect(() => {
    const first = notice?.items[0];
    if (!first || shown) return;
    shown = true;
    void read(api.api.views["recovered-notice"].seen.$post()).catch(
      () => undefined,
    );
    const more = notice.items.length - 1;
    toastManager.add({
      title:
        more > 0
          ? `Staaash kept ${notice.items.length} copies`
          : "Staaash kept a copy",
      description: more > 0 ? `${first.name} and ${more} more` : first.name,
      type: "info",
      timeout: 0,
      actionProps: {
        children: "Show",
        onClick: () =>
          void navigate({
            href: `${first.folderId ? `/files/f/${first.folderId}` : "/files"}?show=${first.id}`,
          }),
      },
    });
  }, [notice, navigate]);
  return null;
}
