/** How much the worker reads with OCR: nothing, PDF pages without text, or also pictures. */
export const OCR_MODES = ["off", "pdf", "all"] as const;
export type OcrMode = (typeof OCR_MODES)[number];

/**
 * The Tesseract models the Docker image ships, by code. Adding one means
 * adding its checksum to scripts/tessdata.sha256 too.
 */
export const OCR_LANGUAGES: Record<string, string> = {
  eng: "English",
  ara: "Arabic",
  ben: "Bengali",
  chi_sim: "Chinese (Simplified)",
  chi_tra: "Chinese (Traditional)",
  ces: "Czech",
  dan: "Danish",
  nld: "Dutch",
  fin: "Finnish",
  fra: "French",
  deu: "German",
  ell: "Greek",
  heb: "Hebrew",
  hin: "Hindi",
  hun: "Hungarian",
  ind: "Indonesian",
  ita: "Italian",
  jpn: "Japanese",
  kor: "Korean",
  nor: "Norwegian",
  fas: "Persian",
  pol: "Polish",
  por: "Portuguese",
  ron: "Romanian",
  rus: "Russian",
  spa: "Spanish",
  swe: "Swedish",
  tha: "Thai",
  tur: "Turkish",
  ukr: "Ukrainian",
  vie: "Vietnamese",
};

/**
 * With no choice saved, a server with one CPU core reads no scans: on one
 * core, OCR made opening folders and uploads 1.4 to 1.9 times slower.
 */
export const automaticOcrMode = (cpus: number): OcrMode =>
  cpus >= 2 ? "pdf" : "off";

/** The text readers a worker found installed. */
export type TextTools = {
  pdftotext: string | null;
  pdftoppm: boolean;
  tesseract: string | null;
  /** Installed Tesseract languages. */
  languages: string[];
  ffmpeg: boolean;
};

/** What OCR reads, given the setting and the tools the worker has. */
export const scanPlan = (mode: OcrMode, chosen: string[], tools: TextTools) => {
  const languages = tools.tesseract
    ? chosen.filter((language) => tools.languages.includes(language)).sort()
    : [];
  const sources: ("pdf" | "image")[] = [];
  if (languages.length > 0 && mode !== "off") {
    if (tools.pdftoppm) sources.push("pdf");
    if (mode === "all" && tools.ffmpeg) sources.push("image");
  }
  return { sources, languages };
};
