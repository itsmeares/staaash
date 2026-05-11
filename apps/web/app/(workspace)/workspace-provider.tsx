"use client";

import { TransferProvider } from "./transfer-context";
import { TransferPanel } from "./transfer-panel";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return (
    <TransferProvider>
      {children}
      <TransferPanel />
    </TransferProvider>
  );
}
