"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ViewerKind } from "@staaash/db/viewer-contract";

import { TextFileViewer } from "@/app/text-file-viewer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ItemPreview, MiddleName } from "./file-list";

export type ViewerFile = {
  id: string;
  name: string;
  mimeType: string;
  viewerKind: ViewerKind;
  thumbnailUrl?: string | null;
};

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Full-screen viewer for one file in a set: arrows and the filmstrip move
 * through the set, Esc closes. When `origin` is the clicked thumbnail, an
 * image grows out of it.
 */
export function MediaViewer({
  files,
  index,
  onIndexChange,
  onClose,
  origin,
  contentHref = (id) => `/api/files/files/${id}/content`,
  downloadHref = (id) => `/api/files/files/${id}/download`,
}: {
  files: ViewerFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  origin?: DOMRect | null;
  contentHref?: (id: string) => string;
  downloadHref?: ((id: string) => string) | null;
}) {
  const file = files[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  const grownFrom = useRef<string | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && index > 0) {
        onIndexChange(index - 1);
      } else if (event.key === "ArrowRight" && index < files.length - 1) {
        onIndexChange(index + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [files.length, index, onClose, onIndexChange]);

  useEffect(() => {
    filmRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  if (!file) return null;

  // FLIP: start the image at the thumbnail's box, then let it settle.
  const growFromOrigin = (image: HTMLImageElement) => {
    if (!origin || grownFrom.current || reducedMotion()) return;
    grownFrom.current = file.id;
    const target = image.getBoundingClientRect();
    if (target.width === 0) return;
    image.animate(
      [
        {
          transform: `translate(${origin.left - target.left}px, ${origin.top - target.top}px) scale(${origin.width / target.width}, ${origin.height / target.height})`,
          transformOrigin: "top left",
          borderRadius: "12px",
        },
        { transform: "none", transformOrigin: "top left", borderRadius: "0" },
      ],
      { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };

  const href = contentHref(file.id);
  const content =
    file.viewerKind === "image" ? (
      <img
        alt={file.name}
        className="max-h-full max-w-full object-contain select-none"
        key={file.id}
        onLoad={(event) => growFromOrigin(event.currentTarget)}
        src={href}
      />
    ) : file.viewerKind === "video" ? (
      <video
        autoPlay
        className="max-h-full max-w-full"
        controls
        key={file.id}
        playsInline
        preload="metadata"
        src={href}
      >
        Your browser could not play this video.
      </video>
    ) : file.viewerKind === "audio" ? (
      <div className="grid w-full max-w-md gap-4 rounded-2xl bg-card p-6 text-card-foreground">
        <MiddleName className="font-medium" name={file.name} />
        <audio autoPlay className="w-full" controls key={file.id} src={href} />
      </div>
    ) : file.viewerKind === "pdf" ? (
      <embed
        className="size-full rounded-lg bg-white"
        key={file.id}
        src={href}
        type="application/pdf"
      />
    ) : (
      <div className="flex size-full max-w-4xl overflow-hidden rounded-xl bg-card text-card-foreground">
        <TextFileViewer contentHref={href} key={file.id} />
      </div>
    );

  return createPortal(
    <div
      aria-label={file.name}
      aria-modal
      className="fixed inset-0 z-50 flex animate-in flex-col bg-black text-white duration-260 fade-in motion-reduce:animate-none"
      role="dialog"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Button
          aria-label="Close"
          ref={closeRef}
          size="icon"
          variant="media-close"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
        <div className="grid min-w-0 flex-1 px-1">
          <MiddleName className="text-body font-medium" name={file.name} />
          {files.length > 1 ? (
            <span className="text-label text-white/80 tabular-nums">
              {index + 1} of {files.length}
            </span>
          ) : null}
        </div>
        {file.viewerKind === "pdf" ? (
          <Button
            render={<a href={href} rel="noreferrer" target="_blank" />}
            size="sm"
            variant="media"
          >
            <ExternalLink aria-hidden />
            <span className="max-sm:hidden">Open in new tab</span>
          </Button>
        ) : null}
        {downloadHref ? (
          <Button
            render={<a href={downloadHref(file.id)} />}
            size="sm"
            variant="media"
          >
            <Download aria-hidden />
            <span className="max-sm:hidden">Download</span>
          </Button>
        ) : null}
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
        {content}
        {index > 0 ? (
          <Button
            aria-label="Previous"
            className="left-2"
            size="icon-lg"
            variant="media-navigation"
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
        ) : null}
        {index < files.length - 1 ? (
          <Button
            aria-label="Next"
            className="right-2"
            size="icon-lg"
            variant="media-navigation"
            onClick={() => onIndexChange(index + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        ) : null}
      </div>

      {files.length > 1 ? (
        <div
          aria-label="Files in this folder"
          className="shrink-0 [scrollbar-width:none] overflow-x-auto px-4 pb-4"
          ref={filmRef}
        >
          <div className="mx-auto flex w-max gap-1.5">
            {files.map((entry, entryIndex) => (
              <button
                aria-current={entryIndex === index}
                aria-label={entry.name}
                className={cn(
                  "w-16 shrink-0 cursor-pointer rounded-lg opacity-60 ring-2 ring-transparent transition-opacity duration-150 outline-none hover:opacity-100 focus-visible:ring-white",
                  entryIndex === index && "opacity-100 ring-primary",
                )}
                key={entry.id}
                type="button"
                onClick={() => onIndexChange(entryIndex)}
              >
                <ItemPreview
                  className="rounded-lg bg-white/10"
                  iconClassName="size-6 [&_svg]:size-5"
                  item={{
                    kind: "file",
                    mimeType: entry.mimeType,
                    thumbnailUrl: entry.thumbnailUrl,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
