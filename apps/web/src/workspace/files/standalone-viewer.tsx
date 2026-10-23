import { useNavigate } from "@tanstack/react-router";
import { toast } from "@staaash/ui/components/toast";
import { loadViewerBatch } from "../list-actions";
import { useCallback } from "react";

import {
  MediaViewer,
  type ViewerFile,
} from "@/components/file-list/media-viewer";

/** The viewer on its own page, for links and refresh. */
export function StandaloneViewer({
  files,
  start,
  total,
  folderId,
  fileId,
  backHref,
}: {
  files: ViewerFile[];
  start: number;
  total: number;
  folderId: string;
  fileId: string;
  backHref: string;
}) {
  const navigate = useNavigate();
  const index = Math.max(
    0,
    files.findIndex((file) => file.id === fileId),
  );
  const load = useCallback(
    async (offset: number) => (await loadViewerBatch(folderId, offset)).files,
    [folderId],
  );
  return (
    <MediaViewer
      files={files}
      navigation={{
        position: start + index,
        total,
        start,
        load,
        onNavigate: (next) => {
          const file = files[next - start];
          if (file)
            void navigate({ replace: true, href: `/files/view/${file.id}` });
          else
            void loadViewerBatch(folderId, next)
              .then((page) => {
                const nextFile = page.files[0];
                if (nextFile)
                  void navigate({
                    replace: true,
                    href: `/files/view/${nextFile.id}`,
                  });
              })
              .catch(() => toast.error("The file could not load. Try again."));
        },
      }}
      index={index}
      onClose={() => void navigate({ href: backHref })}
      onIndexChange={(next) => {
        const file = files[next];
        if (file)
          void navigate({ replace: true, href: `/files/view/${file.id}` });
      }}
    />
  );
}
