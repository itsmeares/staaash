"use client";

import { useRouter } from "next/navigation";

import {
  MediaViewer,
  type ViewerFile,
} from "@/components/file-list/media-viewer";

/** The viewer on its own page, for links and refresh. */
export function StandaloneViewer({
  files,
  fileId,
  backHref,
}: {
  files: ViewerFile[];
  fileId: string;
  backHref: string;
}) {
  const router = useRouter();
  const index = Math.max(
    0,
    files.findIndex((file) => file.id === fileId),
  );
  return (
    <MediaViewer
      files={files}
      index={index}
      onClose={() => router.push(backHref)}
      onIndexChange={(next) => {
        const file = files[next];
        if (file) router.replace(`/files/view/${file.id}`);
      }}
    />
  );
}
