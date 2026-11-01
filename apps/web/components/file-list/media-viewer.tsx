import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ViewerKind } from "@staaash/config/media-types";

import { TextFileViewer } from "@/src/text-file-viewer";
import { Button } from "@staaash/ui/components/button";
import { cn } from "@staaash/ui/utils";

import { AudioPlayer } from "./audio-player";
import { ViewerFilmstrip } from "./viewer-filmstrip";
import { MiddleName } from "./middle-name";
import { useViewerGestures } from "./use-viewer-gestures";

/** A button in the phone viewer's bottom bar. */
export type ViewerAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

/** Phones: dots for where you are in the set, then the actions. */
function PhoneViewerBar({
  actions,
  className,
  count,
  index,
}: {
  actions?: ViewerAction[];
  className: string;
  count: number;
  index: number;
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 gap-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:hidden",
        className,
      )}
    >
      {count > 1 && count <= 15 ? (
        <div aria-hidden className="flex justify-center gap-1.5">
          {Array.from({ length: count }, (_, at) => (
            <span
              className={cn(
                "size-1.5 rounded-full bg-white/40",
                at === index && "bg-white",
              )}
              key={at}
            />
          ))}
        </div>
      ) : null}
      {actions ? (
        <div className="grid auto-cols-fr grid-flow-col">
          {actions.map((action) => (
            <button
              className={cn(
                "grid cursor-pointer justify-items-center gap-1 text-tab text-white outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-5",
                action.destructive && "text-destructive-foreground",
              )}
              key={action.label}
              type="button"
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type ViewerFile = {
  id: string;
  name: string;
  mimeType: string;
  viewerKind: ViewerKind;
  thumbnailUrl?: string | null;
};

const noSubscription = () => () => {};

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Full-screen viewer for one file in a set: arrows and the filmstrip move
 * through the set, Esc closes. When `origin` is the clicked thumbnail, an
 * image grows out of it.
 */
// Image, video, audio and unsupported files, plus the filmstrip and zoom.
// fallow-ignore-next-line complexity
export function MediaViewer({
  files,
  index,
  onIndexChange,
  onClose,
  origin,
  contentHref = (id) => `/api/files/files/${id}/content`,
  downloadHref = (id) => `/api/files/files/${id}/download`,
  actions,
  navigation,
  hasMore = false,
  loadMore,
}: {
  navigation?: {
    position: number;
    total: number;
    start: number;
    load: (offset: number) => Promise<ViewerFile[]>;
    onNavigate: (index: number) => void;
  };
  hasMore?: boolean;
  loadMore?: () => Promise<unknown>;
  files: ViewerFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  origin?: DOMRect | null;
  contentHref?: (id: string) => string;
  downloadHref?: ((id: string) => string) | null;
  /** Phones show these along the bottom: Share, Download, Details, Trash. */
  actions?: (file: ViewerFile) => ViewerAction[];
}) {
  const file = files[index];
  const position = navigation?.position ?? index;
  const count = navigation?.total ?? files.length;
  const navigate = navigation?.onNavigate ?? onIndexChange;
  const canNext = position < count - 1 || hasMore;

  // A tap on the photo hides the controls, another brings them back.
  const [chrome, setChrome] = useState(true);
  const gestures = useViewerGestures({
    onNext: () => canNext && navigate(position + 1),
    onPrevious: () => position > 0 && navigate(position - 1),
    onClose,
    onTap: () => setChrome((shown) => !shown),
  });
  const { reset } = gestures;
  useEffect(() => reset(), [file?.id, reset]);
  const hideable = cn(
    "transition-opacity duration-150 motion-reduce:transition-none",
    !chrome && "pointer-events-none opacity-0",
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const grownFrom = useRef<string | null>(null);
  // The viewer lives in <body>, which a page link renders without at first.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

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
      } else if (event.key === "ArrowLeft" && position > 0) {
        navigate(position - 1);
      } else if (event.key === "ArrowRight" && canNext) {
        navigate(position + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canNext, position, onClose, navigate]);

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
        {...gestures.handlers}
        alt={file.name}
        className="max-h-full max-w-full object-contain select-none"
        draggable={false}
        key={file.id}
        onLoad={(event) => growFromOrigin(event.currentTarget)}
        src={href}
        style={gestures.style}
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
      <AudioPlayer
        coverUrl={file.thumbnailUrl}
        key={file.id}
        name={file.name}
        src={href}
      />
    ) : file.viewerKind === "pdf" ? (
      <embed
        className="size-full rounded-lg bg-white"
        key={file.id}
        src={href}
        type="application/pdf"
      />
    ) : (
      <div className="flex size-full max-w-4xl overflow-hidden rounded-xl bg-card text-card-foreground">
        <TextFileViewer contentHref={href} key={file.id} name={file.name} />
      </div>
    );

  if (!inBrowser) return null;
  return createPortal(
    <div
      aria-label={file.name}
      aria-modal
      data-slot="media-viewer"
      // The page stays visible behind, blurred and dimmed, so clicking it
      // reads as "back". Reduced transparency gets a plain dark dim.
      className="fixed inset-0 z-50 flex animate-in flex-col bg-black/60 text-white backdrop-blur-md duration-260 fade-in motion-reduce:animate-none contrast-more:bg-black/90 contrast-more:backdrop-blur-none [@media(prefers-reduced-transparency:reduce)]:bg-black/90 [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"
      role="dialog"
    >
      <header
        className={cn("flex h-14 shrink-0 items-center gap-2 px-3", hideable)}
      >
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
          {count > 1 ? (
            <span className="text-label text-white/80 tabular-nums">
              {position + 1} of {count}
              {hasMore ? "+" : ""}
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
            // Phones with actions already have Download in the bottom bar.
            className={actions ? "max-sm:hidden" : undefined}
            render={<a href={downloadHref(file.id)} />}
            size="sm"
            variant="media"
          >
            <Download aria-hidden />
            <span className="max-sm:hidden">Download</span>
          </Button>
        ) : null}
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {content}
        {position > 0 ? (
          <Button
            aria-label="Previous"
            className={cn("left-2 max-sm:hidden", hideable)}
            size="icon-lg"
            variant="media-navigation"
            onClick={() => navigate(position - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
        ) : null}
        {canNext ? (
          <Button
            aria-label="Next"
            className={cn("right-2 max-sm:hidden", hideable)}
            size="icon-lg"
            variant="media-navigation"
            onClick={() => navigate(position + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        ) : null}
      </div>

      {count > 1 ? (
        <ViewerFilmstrip
          className={cn("shrink-0 px-4 pb-4 max-sm:hidden", hideable)}
          files={files}
          start={navigation?.start}
          index={position}
          total={count}
          load={navigation?.load}
          onNavigate={navigate}
          hasMore={hasMore}
          loadMore={loadMore}
        />
      ) : null}
      <PhoneViewerBar
        actions={actions?.(file)}
        className={hideable}
        count={count}
        index={position}
      />
    </div>,
    document.body,
  );
}
