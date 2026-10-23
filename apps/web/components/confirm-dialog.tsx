
import { useEffect, useState } from "react";

import { Button } from "@staaash/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@staaash/ui/components/dialog";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Red confirm button, for things that can't be undone. */
  destructive?: boolean;
};

type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((request: Request) => void) | null = null;

/**
 * Asks before something that can't be taken back. Resolves true when the
 * person confirms. Reversible actions act at once with an Undo toast instead.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ ...options, resolve });
  });
}

/** Mounted once in the app shell; renders whatever confirmAction asks. */
export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);

  useEffect(() => {
    show = setRequest;
    return () => {
      show = null;
    };
  }, []);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => !open && close(false)}
    >
      {request ? (
        <DialogPopup className="sm:max-w-100" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            {request.description ? (
              <DialogDescription>{request.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              autoFocus
              variant={request.destructive ? "destructive" : "default"}
              onClick={() => close(true)}
            >
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}
