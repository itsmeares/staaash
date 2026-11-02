export type BrowserDownload = {
  id: string;
  name: string;
  mimeType: string;
  receivedBytes: number;
  totalBytes: number | null;
  state:
    | "selecting"
    | "downloading"
    | "interrupted"
    | "completed"
    | "cancelled"
    | "failed";
  canResume: boolean;
};

export type DesktopDownloads = {
  getState: () => Promise<BrowserDownload[]>;
  onState: (listener: (downloads: BrowserDownload[]) => void) => () => void;
  cancel: (id: string) => Promise<{ error: string | null }>;
  resume: (id: string) => Promise<{ error: string | null }>;
  reveal: (id: string) => Promise<{ error: string | null }>;
  clearFinished: () => Promise<{ error: string | null }>;
};
