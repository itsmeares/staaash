import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Staaash",
  description:
    "A self-hosted personal cloud drive with a calm web surface, deliberate sharing, and owned storage boundaries.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="font-sans">
      <body>{children}</body>
    </html>
  );
}
