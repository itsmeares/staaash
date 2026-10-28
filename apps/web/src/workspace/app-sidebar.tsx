import { useLocation } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { formatVersionLabel } from "@staaash/config/version";

import { DriveGlyph } from "@/components/drive-glyph";

import { useUpdates } from "./updates";
import { NewMenu } from "./new-menu";
import {
  SidebarLink,
  SidebarNav,
  SidebarPins,
  adminLinkItem,
  adminNavItems,
  backToDriveItem,
  driveNavItems,
  isAdminPath,
} from "./workspace-nav";
import { WorkspaceStorage } from "./workspace-storage";

/** A pinned favorite shown under Trash, when the person turned that on. */
export type ShellPin = {
  id: string;
  kind: "file" | "folder";
  name: string;
  mimeType?: string;
  color?: string | null;
  href: string;
};

export type ShellInfo = {
  instanceName: string;
  pins: ShellPin[];
  isOwner: boolean;
  appVersion: string;
  usedBytes: string;
  limitBytes: string | null;
  diskUsedBytes: string | null;
  diskCapacityBytes: string | null;
};

function DriveBrand({ instanceName }: { instanceName: string }) {
  return (
    <AppLink
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-1 font-heading text-xl leading-tight font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href="/home"
    >
      <DriveGlyph />
      <span className="line-clamp-2 wrap-anywhere">{instanceName}</span>
    </AppLink>
  );
}

/** The update note, for owners who want it. Opens the About dialog. */
export function UpdateNote() {
  const { state, notify, openAbout } = useUpdates();
  const newest = state?.status === "update-available" ? state.missed[0] : null;
  if (!newest || !notify) return null;
  return (
    <button
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-primary/12 px-2.5 py-2 text-left text-label outline-none hover:bg-primary/16 focus-visible:ring-2 focus-visible:ring-ring"
      type="button"
      onClick={openAbout}
    >
      <Zap aria-hidden className="size-3.5 shrink-0 text-primary-ink" />
      <span>
        <b className="font-semibold">{formatVersionLabel(newest.version)}</b> is
        out
      </span>
      <span className="ms-auto font-medium text-primary-ink">
        What&apos;s new
      </span>
    </button>
  );
}

/** The running version; opens the About dialog. */
export function VersionButton() {
  const { appVersion, openAbout } = useUpdates();
  return (
    <button
      className="w-fit cursor-pointer rounded-sm px-2.5 text-label text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      type="button"
      onClick={openAbout}
    >
      {formatVersionLabel(appVersion)}
    </button>
  );
}

export function AppSidebar({ info }: { info: ShellInfo }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const inAdmin = isAdminPath(pathname);

  return (
    <aside
      className="hidden min-h-0 flex-col gap-3 overflow-y-auto px-2.5 pt-3.5 pb-3 desk:flex"
      data-workspace-sidebar
    >
      <DriveBrand instanceName={info.instanceName} />

      {inAdmin ? (
        <div className="flex flex-col gap-1">
          <h2 className="m-0 px-2.5 pt-2 pb-1 font-sans text-label font-medium text-muted-foreground">
            Admin
          </h2>
          <SidebarNav items={adminNavItems} label="Admin" />
        </div>
      ) : (
        <>
          <div className="px-0.5">
            <NewMenu />
          </div>
          <SidebarNav items={driveNavItems} label="Drive" />
          <SidebarPins pins={info.pins} />
        </>
      )}

      <div className="mt-auto flex flex-col gap-2.5">
        {/* Admin and its way back share one spot, so the same click undoes itself. */}
        {inAdmin ? (
          <SidebarLink item={backToDriveItem} />
        ) : info.isOwner ? (
          <SidebarLink item={adminLinkItem} />
        ) : null}
        <WorkspaceStorage
          usedBytes={info.usedBytes}
          limitBytes={info.limitBytes}
          diskUsedBytes={info.diskUsedBytes}
          diskCapacityBytes={info.diskCapacityBytes}
          isAdmin={info.isOwner}
        />
        <UpdateNote />
        <VersionButton />
      </div>
    </aside>
  );
}

/** Tablets and phones held sideways: icons with small labels. */
export function AppRail({ info }: { info: ShellInfo }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const inAdmin = isAdminPath(pathname);

  return (
    <aside
      className="hidden min-h-0 flex-col items-center gap-2 overflow-y-auto pb-1.5 rail:flex short:pt-1.5"
      data-workspace-rail
    >
      <AppLink
        aria-label={info.instanceName}
        className="flex h-14 shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring short:hidden"
        href="/home"
      >
        <DriveGlyph />
      </AppLink>
      {inAdmin ? (
        <SidebarNav items={adminNavItems} label="Admin" rail />
      ) : (
        <>
          <NewMenu rail />
          <SidebarNav items={driveNavItems} label="Drive" rail />
        </>
      )}
      <div className="mt-auto">
        {inAdmin ? (
          <SidebarLink item={backToDriveItem} rail />
        ) : info.isOwner ? (
          <SidebarLink item={adminLinkItem} rail />
        ) : null}
      </div>
    </aside>
  );
}
