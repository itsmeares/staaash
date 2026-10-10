import { formatVersionLabel } from "@staaash/config/version";

import type { UpdateState } from "@/server/admin/updates";

export type { UpdateState };

/** One short phrase for the update state. */
export const getUpdateStatusLabel = (
  state: Pick<UpdateState, "status" | "missed">,
) => {
  switch (state.status) {
    case "update-available":
      return `${formatVersionLabel(state.missed[0]!.version)} is out`;
    case "up-to-date":
      return "Up to date";
    case "off":
      return "Checks are off";
    case "error":
      return "The last check failed";
    default:
      return "Not checked yet";
  }
};
