import {
  OCR_MODES,
  automaticOcrMode,
  scanPlan,
  type TextTools,
} from "@staaash/config/ocr";
import { getPrisma } from "@staaash/db/client";
import { getFileTextSummary } from "@staaash/db/file-text";

type TextWorker = { cpus?: number; textTools?: TextTools };

/**
 * How files are read on this drive: the saved scan setting, or the one the
 * worker's CPU count picks, and what its installed tools allow. Null worker
 * fields mean no worker has started since this feature came in.
 */
export const getTextReading = async () => {
  const [settings, worker] = await Promise.all([
    getPrisma().systemSettings.findUnique({
      where: { id: "singleton" },
      select: { ocrMode: true, ocrLanguages: true },
    }),
    getPrisma().workerInstance.findFirst({
      where: { metadataJson: { path: ["lane"], equals: "text" } },
      orderBy: { lastHeartbeatAt: "desc" },
      select: { metadataJson: true },
    }),
  ]);
  const { cpus = null, textTools = null } = (worker?.metadataJson ??
    {}) as TextWorker;
  const saved = OCR_MODES.find((mode) => mode === settings?.ocrMode) ?? null;
  const mode = saved ?? (cpus === null ? "off" : automaticOcrMode(cpus));
  const languages = settings?.ocrLanguages ?? ["eng"];
  return {
    saved,
    mode,
    languages,
    cpus,
    tools: textTools,
    /** What OCR reads now, in which of the chosen languages. */
    scan: textTools
      ? scanPlan(mode, languages, textTools)
      : { sources: [], languages: [] },
  };
};

/** The admin page's view: the scan setting, the worker's tools, and progress. */
export const getTextReadingStatus = async () => {
  const reading = await getTextReading();
  return { ...reading, summary: await getFileTextSummary(reading.scan) };
};
