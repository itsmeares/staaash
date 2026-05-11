"use client";

import { TransferProvider } from "./(workspace)/transfer-context";
import { TransferPanel } from "./(workspace)/transfer-panel";

export function TransferRoot({ children }: { children: React.ReactNode }) {
  return (
    <TransferProvider>
      {children}
      <TransferPanel />
    </TransferProvider>
  );
}
