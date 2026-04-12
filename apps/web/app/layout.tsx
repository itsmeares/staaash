import type { Metadata } from "next";
import localFont from "next/font/local";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${switzer.variable} ${cabinetGrotesk.variable} font-sans`}
    >
      <body>{children}</body>
    </html>
  );
}
