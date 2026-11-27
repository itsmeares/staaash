import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { epubText, htmlText, officeText, tidyText } from "./extract.js";

const zip = (files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
    ),
  );

const rels = (targets: Record<string, string>) =>
  `<Relationships>${Object.entries(targets)
    .map(
      ([id, target]) =>
        `<Relationship Id="${id}" Type="x" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;

describe("officeText", () => {
  it("reads a Word document's paragraphs, tabs, notes, and headers, without deleted text or tab stops", () => {
    const text = officeText(
      zip({
        "word/document.xml": `<w:document><w:body>
          <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Invoice</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">No. 42 &amp; more</w:t></w:r></w:p>
          <w:p><w:r><w:delText>old words</w:delText><w:t>Çağrı paid</w:t></w:r></w:p>
        </w:body></w:document>`,
        "word/footnotes.xml":
          "<w:footnotes><w:p><w:t>A footnote</w:t></w:p></w:footnotes>",
        "word/header1.xml": "<w:hdr><w:p><w:t>Letterhead</w:t></w:p></w:hdr>",
        "word/media/image1.png": "not text",
      }),
      "docx",
    );
    expect(text).toBe(
      "Invoice\tNo. 42 & more\nÇağrı paid\n\nA footnote\n\nLetterhead",
    );
  });

  it("reads every sheet of a workbook in tab order, as rows of cells", () => {
    const text = officeText(
      zip({
        "xl/workbook.xml":
          '<workbook><sheets><sheet name="Summary" sheetId="2" r:id="rId2"/><sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": rels({
          rId1: "worksheets/sheet1.xml",
          rId2: "/xl/worksheets/sheet2.xml",
        }),
        "xl/sharedStrings.xml":
          "<sst><si><t>Rent</t></si><si><r><t>Elec</t></r><r><t>tricity</t></r><rPh><t>x</t></rPh></si></sst>",
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>unpaid</t></is></c><c r="C2"/></row></sheetData></worksheet>',
        "xl/worksheets/sheet2.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="str"><f>SUM(B1)</f><v>Total</v></c></row></sheetData></worksheet>',
      }),
      "xlsx",
    );
    expect(text).toBe(
      "Summary\nTotal\n\nQ1 & Q2\nRent\t1200\nElectricity\tunpaid",
    );
  });

  it("reads slides in show order with their speaker notes", () => {
    const text = officeText(
      zip({
        "ppt/presentation.xml":
          '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
        "ppt/_rels/presentation.xml.rels": rels({
          rId2: "slides/slide1.xml",
          rId3: "slides/slide2.xml",
        }),
        "ppt/slides/slide1.xml":
          "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>",
        "ppt/slides/slide2.xml":
          "<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>",
        "ppt/slides/_rels/slide2.xml.rels": rels({
          rId1: "../notesSlides/notesSlide1.xml",
        }),
        "ppt/notesSlides/notesSlide1.xml":
          "<p:notes><a:p><a:t>Say hello</a:t></a:p></p:notes>",
      }),
      "pptx",
    );
    expect(text).toBe("First\n\nSay hello\n\nSecond");
  });

  it("reads OpenDocument text and spreadsheet cells", () => {
    expect(
      officeText(
        zip({
          "content.xml":
            '<office:document-content><text:h>Plan</text:h><text:p>One<text:s/>two<text:tab/>three</text:p><table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell table:number-columns-repeated="3"/><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></table:table></office:document-content>',
        }),
        "ods",
      ),
    ).toBe("Plan\nOne two\tthree\nA\t\tB");
  });

  it("stops a zip whose entries claim to unpack too large", () => {
    expect(() =>
      officeText(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "docx"),
    ).toThrow();
  });
});

describe("htmlText", () => {
  it("keeps the visible words of a page and drops scripts and styles", () => {
    expect(
      htmlText(`<!doctype html><html><head><title>Ignored</title><style>p{}</style></head>
        <body><header>Menu</header><script>var secret = 1;</script>
        <h1>Caf&eacute;   news</h1><p>Line one<br>line two &amp; &#8220;three&#8221;</p>
        <table><tr><td>a</td><td>b</td></tr></table><!-- hidden --></body></html>`),
    ).toBe("Menu\n\nCafé news\n\nLine one\nline two & “three”\n\na\tb");
  });
});

describe("markup that looks like tags", () => {
  it("reads past a comparison in a script and a `>` in an attribute", () => {
    expect(
      htmlText(
        '<script>if (a < b) run();</script><p title="a > lighthouse">coast</p><style>p<b {}</style>shore',
      ),
    ).toBe("coast\nshore");
  });
});

describe("unfinished markup", () => {
  it("ends the text at an unclosed script, comment, or tag, as a browser does", () => {
    expect(htmlText("<p>Kept</p><script>var x = 1; <p>hidden")).toBe("Kept");
    expect(htmlText("<p>Kept</p><!-- never closed <p>hidden")).toBe("Kept");
    expect(htmlText("<p>Kept</p><b class=")).toBe("Kept");
  });

  it("drops NUL characters, which PostgreSQL cannot store", () => {
    expect(tidyText("a\0b")).toBe("ab");
  });
});

describe("epubText", () => {
  it("reads chapters in spine order, not file order, with either quote", () => {
    const text = epubText(
      zip({
        mimetype: "application/epub+zip",
        "META-INF/container.xml":
          "<container><rootfiles><rootfile note=\" full-path='missing.opf'\" full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>",
        "OEBPS/content.opf": `<package><manifest><item id = 'a' href="text/one.xhtml" media-type="application/xhtml+xml"/><item href="text/two%20b.xhtml" id="b" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`,
        "OEBPS/text/one.xhtml": "<html><body><p>Chapter one</p></body></html>",
        "OEBPS/text/two b.xhtml": "<html><body><p>Preface</p></body></html>",
      }),
    );
    expect(text).toBe("Preface\n\nChapter one");
  });
});
