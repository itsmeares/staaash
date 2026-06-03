"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

const BOTTOM_SHEET_CLOSE_THRESHOLD = 64;
const BOTTOM_SHEET_TOP_DRAG_ZONE = 76;
const BOTTOM_SHEET_CLOSE_ANIMATION_MS = 180;

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  onSwipeClose,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  onSwipeClose?: () => void;
  showCloseButton?: boolean;
}) {
  const isBottomSheet =
    typeof className === "string" &&
    className.includes("workspace-bottom-sheet");
  const bottomSheetDrag = React.useRef<{
    input: "pointer" | "touch";
    lastY: number;
    pointerId: number | null;
    startY: number;
  } | null>(null);

  const resetBottomSheetDrag = (target: HTMLDivElement) => {
    target.style.transition = "";
    target.style.removeProperty("--bottom-sheet-drag-y");
    target.removeAttribute("data-dragging");
    bottomSheetDrag.current = null;
  };

  const setBottomSheetDragY = (target: HTMLDivElement, deltaY: number) => {
    target.style.setProperty("--bottom-sheet-drag-y", `${deltaY}px`);
  };

  const closeBottomSheetWithMotion = (target: HTMLDivElement) => {
    if (!onSwipeClose || target.dataset.closing === "true") return;

    bottomSheetDrag.current = null;
    target.dataset.closing = "true";
    target.removeAttribute("data-dragging");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bottomSheetDrag.current = null;
      onSwipeClose();
      return;
    }

    const closeDistance = Math.ceil(target.getBoundingClientRect().height + 48);
    target.style.transition = `transform ${BOTTOM_SHEET_CLOSE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    let didFinishClose = false;

    const finishClose = () => {
      if (didFinishClose) return;
      didFinishClose = true;
      clearTimeout(fallbackTimer);
      target.removeEventListener("transitionend", handleTransitionEnd);
      bottomSheetDrag.current = null;
      onSwipeClose();
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === target && event.propertyName === "transform") {
        finishClose();
      }
    };

    const fallbackTimer = window.setTimeout(
      finishClose,
      BOTTOM_SHEET_CLOSE_ANIMATION_MS + 80,
    );

    target.addEventListener("transitionend", handleTransitionEnd);
    window.requestAnimationFrame(() => {
      setBottomSheetDragY(target, closeDistance);
    });
  };

  const startBottomSheetDrag = (
    target: HTMLDivElement,
    eventTarget: EventTarget,
    clientY: number,
    input: "pointer" | "touch",
    pointerId: number | null = null,
  ) => {
    if (!isBottomSheet || !onSwipeClose || bottomSheetDrag.current) {
      return false;
    }
    const eventElement = eventTarget instanceof Element ? eventTarget : null;
    const isHandle = eventElement?.closest("[data-bottom-sheet-drag-handle]");
    const isInteractive = eventElement?.closest(
      "a, button, input, select, textarea, summary, [role='button']",
    );
    const isTopDragZone =
      clientY - target.getBoundingClientRect().top <=
        BOTTOM_SHEET_TOP_DRAG_ZONE && !isInteractive;

    if (!isHandle && !isTopDragZone) {
      return false;
    }
    bottomSheetDrag.current = {
      input,
      lastY: clientY,
      pointerId,
      startY: clientY,
    };
    target.style.transition = "none";
    target.setAttribute("data-dragging", "true");
    return true;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (event.defaultPrevented) return;
    const started = startBottomSheetDrag(
      event.currentTarget,
      event.target,
      event.clientY,
      "pointer",
      event.pointerId,
    );
    if (!started) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (
      !drag ||
      drag.input !== "pointer" ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    drag.lastY = event.clientY;
    const deltaY = Math.max(0, event.clientY - drag.startY);
    setBottomSheetDragY(event.currentTarget, deltaY);
  };

  const finishBottomSheetDrag = (target: HTMLDivElement) => {
    const drag = bottomSheetDrag.current;
    if (!drag) return;

    const deltaY = Math.max(0, drag.lastY - drag.startY);

    if (deltaY >= BOTTOM_SHEET_CLOSE_THRESHOLD && onSwipeClose) {
      closeBottomSheetWithMotion(target);
      return;
    }

    target.style.transition = "";
    setBottomSheetDragY(target, 0);
    target.removeAttribute("data-dragging");
    bottomSheetDrag.current = null;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (
      !drag ||
      drag.input !== "pointer" ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishBottomSheetDrag(event.currentTarget);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (
      !drag ||
      drag.input !== "pointer" ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetBottomSheetDrag(event.currentTarget);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const started = startBottomSheetDrag(
      event.currentTarget,
      event.target,
      touch.clientY,
      "touch",
    );
    if (!started) return;
    event.preventDefault();
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (!drag || drag.input !== "touch" || event.touches.length !== 1) return;

    event.preventDefault();
    const touch = event.touches[0];
    drag.lastY = touch.clientY;
    const deltaY = Math.max(0, touch.clientY - drag.startY);
    setBottomSheetDragY(event.currentTarget, deltaY);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (!drag || drag.input !== "touch") return;
    finishBottomSheetDrag(event.currentTarget);
  };

  const handleTouchCancel = (event: React.TouchEvent<HTMLDivElement>) => {
    const drag = bottomSheetDrag.current;
    if (!drag || drag.input !== "touch") return;
    resetBottomSheetDrag(event.currentTarget);
  };

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        {...props}
        className={cn(
          isBottomSheet
            ? "fixed inset-x-0 bottom-0 z-50 grid w-full gap-6 bg-popover text-sm text-popover-foreground ring-1 ring-foreground/5 duration-100 outline-none dark:ring-foreground/10"
            : "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-4xl bg-popover p-6 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/5 duration-100 outline-none sm:max-w-md dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchCancel={handleTouchCancel}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-secondary"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
