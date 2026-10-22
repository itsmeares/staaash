"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { toastManager } from "@staaash/ui/components/toast";

/**
 * Forms that post without JavaScript come back with `?error=` or
 * `?success=`. Show those as toasts once, then drop them from the address so
 * a refresh doesn't repeat them. Errors stay until closed.
 */
export function FlashToasts() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const error = params.get("error");
  const success = params.get("success");

  useEffect(() => {
    if (!error && !success) return;
    if (error) toastManager.add({ title: error, type: "error", timeout: 0 });
    if (success) toastManager.add({ title: success, type: "success" });
    const rest = new URLSearchParams(params);
    rest.delete("error");
    rest.delete("success");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [error, success, params, pathname, router]);

  return null;
}
