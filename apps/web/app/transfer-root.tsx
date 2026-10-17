"use client";

import { TransferProvider } from "./(workspace)/transfer-context";

export function TransferRoot({ children }: { children: React.ReactNode }) {
  return <TransferProvider>{children}</TransferProvider>;
}
