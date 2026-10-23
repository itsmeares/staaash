import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { toastManager } from "@staaash/ui/components/toast";

/**
 * Pages that send someone elsewhere after a problem add `?error=` or
 * `?success=`. Show those as toasts once, then drop them from the address so
 * a refresh doesn't repeat them. Errors stay until closed.
 */
export function FlashToasts() {
  const navigate = useNavigate();
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const error = params.get("error");
    const success = params.get("success");
    if (!error && !success) return;
    if (error) toastManager.add({ title: error, type: "error", timeout: 0 });
    if (success) toastManager.add({ title: success, type: "success" });
    params.delete("error");
    params.delete("success");
    const query = params.toString();
    void navigate({
      href: query ? `${pathname}?${query}` : pathname,
      replace: true,
      resetScroll: false,
    });
  }, [navigate, pathname, searchStr]);

  return null;
}
