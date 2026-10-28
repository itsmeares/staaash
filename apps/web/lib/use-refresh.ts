import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Long lists reload the rows they have when this fires. */
export const LIST_REFRESH_EVENT = "staaash:list-refresh";

/** Reload the data on screen after a change, like reopening the page. */
export const useRefresh = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    // Unchanged page data keeps its identity, so lists are told directly.
    window.dispatchEvent(new Event(LIST_REFRESH_EVENT));
    return queryClient.invalidateQueries();
  }, [queryClient]);
};
