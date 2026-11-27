import path from "node:path";

import { decodeHTML, decodeXML } from "entities";
import { unzipSync } from "fflate";

// What one zip may unpack to. A zip states each entry's size up front, and
// fflate never writes past it, so a zip bomb stops here.
const MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;

const readZip = (zip: Uint8Array, wanted: (name: string) => boolean) => {
  let total = 0;
  const entries = unzipSync(zip, {
    filter: (entry) => {
      if (!wanted(entry.name)) return false;
      total += entry.originalSize;
      return total <= MAX_UNZIPPED_BYTES;
    },
  });
  const decoder = new TextDecoder();
  return new Map(
    Object.entries(entries).map(([name, bytes]) => [
      name,
      decoder.decode(bytes),
    ]),
  );
};

/** Joins lines, drops trailing spaces, and keeps at most one empty line. */
export const tidyText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Text of Office and OpenDocument XML: paragraphs and rows end lines, cells and tabs become tabs. */
const xmlText = (xml: string) =>
  tidyText(
    decodeXML(
      xml
        // Line breaks between tags only lay out the XML; text breaks are tags.
        .replace(/>\s*\n\s*</g, "><")
        // Deleted tracked changes and field codes are not part of the text.
        .replace(/<w:(delText|instrText)\b[^>]*>[\s\S]*?<\/w:\1>/g, "")
        // A spreadsheet cell holds a paragraph; the cell ends with a tab.
        .replace(/<\/text:p>(?=<\/table:table-cell>)/g, "")
        .replace(/<\/(?:w:p|a:p|text:p|text:h|table:table-row)>/g, "\n")
        .replace(/<(?:w:br|w:cr|a:br|text:line-break)\b[^>]*\/>/g, "\n")
        .replace(/<(?:w:tab|text:tab)\b[^>]*\/>|<\/table:table-cell>/g, "\t")
        .replace(/<text:s\b[^>]*\/>/g, " ")
        .replace(/<[^>]*>/g, ""),
    ),
  );

/** Targets of a part's relationships by id, as paths inside the zip. */
const relationships = (
  entries: Map<string, string>,
  part: string,
): Map<string, string> => {
  const rels = entries.get(
    path.posix.join(
      path.posix.dirname(part),
      "_rels",
      `${path.posix.basename(part)}.rels`,
    ),
  );
  const targets = new Map<string, string>();
  for (const [tag] of rels?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target) {
      targets.set(
        id,
        target.startsWith("/")
          ? target.slice(1)
          : path.posix.join(path.posix.dirname(part), target),
      );
    }
  }
  return targets;
};

const docx = (entries: Map<string, string>) =>
  [
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    ...[...entries.keys()].filter((name) =>
      /^word\/(header|footer)\d*\.xml$/.test(name),
    ),
  ]
    .map((name) => entries.get(name))
    .filter((xml) => xml !== undefined)
    .map(xmlText)
    .join("\n\n");

/** One block per sheet: its name, then rows of tab-separated cells. */
const xlsx = (entries: Map<string, string>) => {
  const strings = [
    ...(entries.get("xl/sharedStrings.xml") ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map(([, item]) =>
    xmlText((item ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")),
  );
  const sheets = relationships(entries, "xl/workbook.xml");
  return [...(entries.get("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*>/g)]
    .map(([tag]) => {
      const xml = entries.get(sheets.get(attribute(tag, "r:id") ?? "") ?? "");
      const rows = [...(xml ?? "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
        .map(([, row]) =>
          [...(row ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
            .map(([, attributes, body = ""]) => {
              const type = attribute(attributes ?? "", "t");
              if (type === "inlineStr") return xmlText(body);
              const value = decodeXML(
                /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "",
              );
              return type === "s" ? (strings[Number(value)] ?? "") : value;
            })
            .join("\t")
            .trimEnd(),
        )
        .filter(Boolean);
      return [decodeXML(attribute(tag, "name") ?? ""), ...rows].join("\n");
    })
    .join("\n\n");
};

/** Slides in show order, each followed by its speaker notes. */
const pptx = (entries: Map<string, string>) => {
  const slides = relationships(entries, "ppt/presentation.xml");
  return [
    ...(entries.get("ppt/presentation.xml") ?? "").matchAll(
      /<p:sldId\b[^>]*>/g,
    ),
  ]
    .map(([tag]) => slides.get(attribute(tag, "r:id") ?? ""))
    .filter((slide) => slide !== undefined)
    .map((slide) => {
      const notes = [...relationships(entries, slide).values()].find((part) =>
        part.includes("notesSlides/"),
      );
      return [entries.get(slide), notes && entries.get(notes)]
        .filter((xml) => xml !== undefined && xml !== "")
        .map((xml) => xmlText(xml as string))
        .join("\n\n");
    })
    .join("\n\n");
};

const OFFICE_PARTS: Record<string, RegExp> = {
  docx: /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/,
  xlsx: /^xl\/(workbook|sharedStrings)\.xml$|^xl\/worksheets\/[^/]+\.xml$|^xl\/_rels\//,
  pptx: /^ppt\/(presentation|slides\/[^/]+|notesSlides\/[^/]+)\.xml$|_rels\/[^/]+\.xml\.rels$/,
};

/** Text of a Word, Excel, or PowerPoint file, or their OpenDocument kin. */
export const officeText = (zip: Uint8Array, extension: string) => {
  if (!(extension in OFFICE_PARTS)) {
    return xmlText(
      readZip(zip, (name) => name === "content.xml").get("content.xml") ?? "",
    );
  }
  const entries = readZip(zip, (name) => OFFICE_PARTS[extension]!.test(name));
  return tidyText(
    extension === "docx"
      ? docx(entries)
      : extension === "xlsx"
        ? xlsx(entries)
        : pptx(entries),
  );
};

const BLOCK_TAGS =
  "address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul";

/** Visible text of a web page: no scripts, styles, or tags. */
export const htmlText = (html: string) =>
  tidyText(
    decodeHTML(
      html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(
          /<(head|script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi,
          " ",
        )
        .replace(/\s+/g, " ")
        .replace(/<br\b[^>]*>/gi, "\n")
        .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
        .replace(/<\/t[dh]\s*>/gi, "\t")
        .replace(/<[^>]*>/g, ""),
    )
      .split("\n")
      .map((line) => line.trim())
      .join("\n"),
  );

/** Chapters of an EPUB book in reading order. */
export const epubText = (zip: Uint8Array) => {
  const entries = readZip(zip, (name) =>
    /^META-INF\/container\.xml$|\.(opf|x?html?)$/i.test(name),
  );
  const packagePath = attribute(
    /<rootfile\b[^>]*>/.exec(
      entries.get("META-INF/container.xml") ?? "",
    )?.[0] ?? "",
    "full-path",
  );
  const opf = entries.get(packagePath ?? "") ?? "";
  const items = new Map(
    [...opf.matchAll(/<item\b[^>]*>/g)].map(([tag]) => [
      attribute(tag, "id"),
      attribute(tag, "href"),
    ]),
  );
  return tidyText(
    [...opf.matchAll(/<itemref\b[^>]*>/g)]
      .map(([tag]) => items.get(attribute(tag, "idref")))
      .filter((href) => href !== undefined)
      .map((href) =>
        entries.get(
          path.posix.join(
            path.posix.dirname(packagePath ?? ""),
            decodeURIComponent(href),
          ),
        ),
      )
      .filter((html) => html !== undefined)
      .map(htmlText)
      .join("\n\n"),
  );
};
