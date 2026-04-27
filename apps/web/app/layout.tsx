import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";

import { THEME_COOKIE_NAME } from "@/server/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Staaash",
  description:
    "A self-hosted personal cloud drive with a calm web surface, deliberate sharing, and owned storage boundaries.",
};

const switzer = localFont({
  src: [
    {
      path: "./fonts/switzer-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/switzer-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/switzer-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/switzer-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-switzer",
  display: "swap",
});

const cabinetGrotesk = localFont({
  src: [
    {
      path: "./fonts/cabinet-grotesk-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/cabinet-grotesk-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/cabinet-grotesk-700.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/cabinet-grotesk-800.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-cabinet",
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_COOKIE_NAME)?.value ?? "system";
  const themeClass =
    theme === "dark" ? "dark" : theme === "light" ? "light" : "";

  return (
    <html
      lang="en"
      className={`${switzer.variable} ${cabinetGrotesk.variable} font-sans${themeClass ? ` ${themeClass}` : ""}`}
    >
      <body>{children}</body>
    </html>
  );
}
