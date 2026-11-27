import path from "node:path";

import { decodeHTML, decodeXML } from "entities";
import { unzipSync } from "fflate";

// What one zip may unpack to. A zip states each entry's size up front, and
// fflate never writes past it, so a zip bomb stops here.
// shortcut: parsing runs on the worker's main thread, so a crafted workbook
// that unpacks to this much holds it for about a minute; move parsing to a
// worker thread if that ever matters.
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

/** Joins lines, drops trailing spaces and NULs, and keeps at most one empty line. */
export const tidyText = (text: string) =>
  text
    .replaceAll("\0", "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Text, or one end of an element. An empty tag is both its start and its end. */
type Token = { text: string } | { tag: string; name: string; end: boolean };

/**
 * Splits markup into text and tags in one pass. A regular expression that
 * looks for a closing tag rescans the rest of the file for every unclosed one,
 * which a hostile file turns into hours of work. An unclosed tag or comment
 * ends the file, as in a browser.
 */
function* tokens(markup: string): Generator<Token> {
  let at = 0;
  while (at < markup.length) {
    const open = markup.indexOf("<", at);
    if (open < 0) {
      yield { text: markup.slice(at) };
      return;
    }
    if (open > at) yield { text: markup.slice(at, open) };
    if (markup.startsWith("<!--", open)) {
      const end = markup.indexOf("-->", open + 4);
      if (end < 0) return;
      at = end + 3;
      continue;
    }
    const close = tagEnd(markup, open + 1);
    if (close < 0) return;
    const tag = markup.slice(open + 1, close);
    yield* tagTokens(tag);
    at = yield* rawText(markup, tag, close + 1);
  }
}

/** Where a tag ends: its first `>` outside a quoted attribute value, or -1. */
const tagEnd = (markup: string, from: number) => {
  let afterEquals = false;
  for (let at = from; at < markup.length; at++) {
    const char = markup[at];
    if (char === ">") return at;
    if (afterEquals && (char === '"' || char === "'")) {
      at = markup.indexOf(char, at + 1);
      if (at < 0) return -1;
    }
    // Spaces may sit between `=` and the quote.
    if (char === "=") afterEquals = true;
    else if (char! > " ") afterEquals = false;
  }
  return -1;
};

const tagName = (tag: string) =>
  (/^\/?([^\s/]*)/.exec(tag)?.[1] ?? "").toLowerCase();

// Their text may hold `<`, as in `if (a < b)`, so it runs to the closing tag.
const RAW_TEXT = new Set(["script", "style"]);

/** A script's or style's text after its start tag. Returns where it ends. */
function* rawText(
  markup: string,
  tag: string,
  at: number,
): Generator<Token, number> {
  const name = tagName(tag);
  if (!RAW_TEXT.has(name) || tag.startsWith("/") || tag.endsWith("/")) {
    return at;
  }
  const closing = new RegExp(`</${name}[\\s/>]`, "gi");
  closing.lastIndex = at;
  const end = closing.exec(markup)?.index ?? markup.length;
  if (end > at) yield { text: markup.slice(at, end) };
  return end;
}

function* tagTokens(tag: string): Generator<Token> {
  const name = tagName(tag);
  const closing = tag.startsWith("/");
  if (!closing) yield { tag, name, end: false };
  if (closing || tag.endsWith("/")) yield { tag, name, end: true };
}

/** Tokens outside the hidden elements. A hidden element's start still comes through. */
function* shownTokens(
  markup: string,
  hidden: ReadonlySet<string>,
): Generator<Token> {
  let inside: string | null = null;
  for (const token of tokens(markup)) {
    if (inside === null) yield token;
    if (!("name" in token)) continue;
    if (inside === null && !token.end && hidden.has(token.name)) {
      inside = token.name;
    } else if (token.end && token.name === inside) inside = null;
  }
}

/** Tags by name, opening or empty, from markup. */
const tagsNamed = (markup: string, name: string) =>
  [...tokens(markup)].flatMap((token) =>
    "name" in token && token.name === name && !token.end ? [token.tag] : [],
  );

// Either quote, as XML allows. No closing quote needed, so a hostile tag
// can't make the search rescan it.
const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)|'([^']*))`).exec(
    tag,
  );
  return match?.[1] ?? match?.[2];
};

/** Whitespace with a line break between two tags only lays out the XML. */
const isLayout = (text: string) => text.includes("\n") && text.trim() === "";

const XML_LINE_ENDS = new Set([
  "w:p",
  "a:p",
  "text:p",
  "text:h",
  "table:table-row",
]);
const XML_INSERTS = new Map([
  ["w:br", "\n"],
  ["w:cr", "\n"],
  ["a:br", "\n"],
  ["text:line-break", "\n"],
  ["w:tab", "\t"],
  ["text:tab", "\t"],
  ["text:s", " "],
]);
// Deleted tracked changes, field codes, and a paragraph's tab stops are not text.
const XML_HIDDEN = new Set(["w:deltext", "w:instrtext", "w:tabs"]);

/** Text of Office and OpenDocument XML: paragraphs and rows end lines, cells and tabs become tabs. */
const xmlText = (xml: string) => {
  let out = "";
  // A paragraph's line end waits, so the cell holding it can end with a tab.
  let lineEnd = "";
  const add = (text: string) => {
    out += lineEnd + text;
    lineEnd = "";
  };
  for (const token of shownTokens(xml, XML_HIDDEN)) {
    if ("text" in token) {
      if (!isLayout(token.text)) add(decodeXML(token.text));
    } else if (!token.end) {
      const insert = XML_INSERTS.get(token.name);
      if (insert) add(insert);
    } else if (token.name === "table:table-cell") {
      lineEnd = "";
      add("\t");
    } else if (XML_LINE_ENDS.has(token.name)) {
      add("");
      lineEnd = "\n";
    }
  }
  return tidyText(out);
};

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
  for (const tag of tagsNamed(rels ?? "", "relationship")) {
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

// Japanese workbooks keep a word's reading next to it.
const PHONETIC = new Set(["rph"]);

/** Each shared string's text, without its phonetic reading. */
const sharedStrings = (xml: string) => {
  const strings: string[] = [];
  let item = "";
  for (const token of shownTokens(xml, PHONETIC)) {
    if ("text" in token) {
      if (!isLayout(token.text)) item += decodeXML(token.text);
    } else if (token.name === "si") {
      if (token.end) strings.push(item);
      item = "";
    }
  }
  return strings;
};

/** A cell holds its text, or a number pointing at a shared string. */
const cellText = (shared: boolean, text: string, strings: string[]) =>
  shared && text ? (strings[Number(text)] ?? "") : text;

/**
 * A sheet's rows of tab-separated cells, without empty rows. A cell's text is
 * its value, or its inline string; a formula is not text.
 */
const sheetRows = (xml: string, strings: string[]) => {
  let out = "";
  let shared = false;
  let text = "";
  let inText = false;
  for (const token of shownTokens(xml, PHONETIC)) {
    if ("text" in token) {
      if (inText) text += decodeXML(token.text);
    } else if (token.name === "v" || token.name === "t") {
      inText = !token.end;
    } else if (token.name === "c") {
      if (token.end) out += `${cellText(shared, text, strings)}\t`;
      shared = attribute(token.tag, "t") === "s";
      text = "";
    } else if (token.name === "row" && token.end) out += "\n";
  }
  return out
    .split("\n")
    .map((row) => row.trimEnd())
    .filter(Boolean);
};

/** One block per sheet: its name, then rows of tab-separated cells. */
const xlsx = (entries: Map<string, string>) => {
  const strings = sharedStrings(entries.get("xl/sharedStrings.xml") ?? "");
  const sheets = relationships(entries, "xl/workbook.xml");
  return tagsNamed(entries.get("xl/workbook.xml") ?? "", "sheet")
    .map((tag) => {
      const xml = entries.get(sheets.get(attribute(tag, "r:id") ?? "") ?? "");
      return [
        decodeXML(attribute(tag, "name") ?? ""),
        ...sheetRows(xml ?? "", strings),
      ].join("\n");
    })
    .join("\n\n");
};

/** Slides in show order, each followed by its speaker notes. */
const pptx = (entries: Map<string, string>) => {
  const slides = relationships(entries, "ppt/presentation.xml");
  return tagsNamed(entries.get("ppt/presentation.xml") ?? "", "p:sldid")
    .map((tag) => slides.get(attribute(tag, "r:id") ?? ""))
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

const HTML_BLOCKS = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tr ul".split(
    " ",
  ),
);
const HTML_HIDDEN = new Set([
  "title",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
]);

/** What a tag adds to a page's text: blocks end lines, cells end with a tab. */
const htmlSpace = ({ name, end }: { name: string; end: boolean }) => {
  if (HTML_BLOCKS.has(name) || (name === "br" && !end)) return "\n";
  if (end && (name === "td" || name === "th")) return "\t";
  // Words on either side of a script stay apart.
  return !end && HTML_HIDDEN.has(name) ? " " : "";
};

/** Visible text of a web page: no scripts, styles, or tags. */
export const htmlText = (html: string) => {
  let out = "";
  for (const token of shownTokens(html, HTML_HIDDEN)) {
    out +=
      "text" in token
        ? decodeHTML(token.text.replace(/\s+/g, " "))
        : htmlSpace(token);
  }
  return tidyText(
    out
      .split("\n")
      .map((line) => line.trim())
      .join("\n"),
  );
};

/** Chapters of an EPUB book in reading order. */
export const epubText = (zip: Uint8Array) => {
  const entries = readZip(zip, (name) =>
    /^META-INF\/container\.xml$|\.(opf|x?html?)$/i.test(name),
  );
  const packagePath = attribute(
    tagsNamed(entries.get("META-INF/container.xml") ?? "", "rootfile")[0] ?? "",
    "full-path",
  );
  const opf = entries.get(packagePath ?? "") ?? "";
  const items = new Map(
    tagsNamed(opf, "item").map((tag) => [
      attribute(tag, "id"),
      attribute(tag, "href"),
    ]),
  );
  return tidyText(
    tagsNamed(opf, "itemref")
      .map((tag) => items.get(attribute(tag, "idref")))
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
