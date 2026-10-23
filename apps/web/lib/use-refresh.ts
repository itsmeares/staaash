import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Reload the data on screen after a change, like reopening the page. */
export const useRefresh = () => {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries(), [queryClient]);
};
