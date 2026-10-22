import type { Metadata } from "next";
import { cookies } from "next/headers";

import { THEME_COOKIE_NAME } from "@/server/auth/session";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { Curtain } from "@/components/curtain";
import { ThemeWatcher } from "@/components/theme-watcher";
import { TransferRoot } from "./transfer-root";
import "./globals.css";

export const metadata: Metadata = {
  title: "Staaash",
  description:
    "A self-hosted personal cloud drive with a calm web surface, deliberate sharing, and owned storage boundaries.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "1024x1024", type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_COOKIE_NAME)?.value ?? "system";
  const preference = theme === "dark" || theme === "light" ? theme : "system";
  const themeClass = preference === "system" ? "" : preference;

  return (
    <html
      lang="en"
      data-theme={preference}
      className={themeClass || undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeWatcher />
        <TransferRoot>{children}</TransferRoot>
        <Curtain />
      </body>
    </html>
  );
}
