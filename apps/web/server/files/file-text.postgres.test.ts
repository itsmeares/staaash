import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import {
  findFileText,
  findFileToScan,
  getFileTextSummary,
  listFilesToRead,
  saveFileText,
  saveScannedPage,
  wantFileText,
} from "@staaash/db/file-text";
import { getSearchPage } from "@/server/retrieval/search-page";

const db = getPrisma();

const drive = async () => {
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@text.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const add = async (
    originalName: string,
    text?: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const file = await db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: root.id,
        originalName,
        storageKey: randomUUID(),
        mimeType: "application/pdf",
        sizeBytes: 10,
        contentChecksum: randomUUID(),
        ...overrides,
      },
    });
    if (text !== undefined) {
      await saveFileText(file, {
        status: "ready",
        source: "pdf",
        text,
        finished: true,
      });
    }
    return file;
  };
  return { owner, root, add };
};

it("finds files by the words inside them, after name matches", async () => {
  const { owner, add } = await drive();
  const bill = await add(
    "scan-001.pdf",
    "Elektrik faturası\fÇağrı Yılmaz, invoice-2024 due Friday",
  );
  const named = await add("Fatura notes.pdf", "nothing here");
  const changed = await add("old.pdf", "fatura from before");
  await db.file.update({
    where: { id: changed.id },
    data: { contentChecksum: "new bytes", sizeBytes: 11 },
  });
  const other = await drive();
  await other.add("theirs.pdf", "fatura of someone else");

  const search = async (query: string) =>
    (await getSearchPage(owner.id, query)).items.map((item) => ({
      name: item.name,
      match: item.matchKind,
      snippet: item.kind === "file" ? item.snippet : undefined,
    }));

  const results = await search("fatura");
  expect(results.map((item) => [item.name, item.match])).toEqual([
    ["Fatura notes.pdf", "exact"],
    ["scan-001.pdf", "text"],
  ]);
  expect(results[1]!.snippet).toContain("Elektrik faturası");
  expect(results[0]!.snippet).toBeUndefined();

  // Accents, word starts, every word, numbers inside a word, and phrases.
  expect((await search("cagri 2024")).map((item) => item.name)).toEqual([
    "scan-001.pdf",
  ]);
  expect(await search("cagri tuesday")).toEqual([]);
  expect(await search("lektrik")).toEqual([]);
  expect((await search('"due friday"')).map((item) => item.name)).toEqual([
    "scan-001.pdf",
  ]);
  expect(await search('"friday due"')).toEqual([]);
  // Quotes don't break a name match, and an okina doesn't break the query.
  expect((await search('fatura "notes"')).map((item) => item.name)).toEqual([
    "Fatura notes.pdf",
  ]);
  await add("lei.pdf", "Our Hawaiʻi trip");
  expect((await search("Hawaiʻi")).map((item) => item.name)).toEqual([
    "lei.pdf",
  ]);
  // One letter finds names only.
  expect((await search("f")).every((item) => item.match !== "text")).toBe(true);
  expect(
    (await getSearchPage(owner.id, "fatura", { kind: "folder" })).items,
  ).toEqual([]);
  expect(named.id).not.toBe(bill.id);
});

it("cuts text a tsvector cannot hold and says so", async () => {
  const { add } = await drive();
  const file = await add("dump.pdf");
  const words = Array.from(
    { length: 30_000 },
    (_, index) => `${randomUUID().replaceAll("-", "")}${index}`,
  ).join(" ");
  await saveFileText(file, {
    status: "ready",
    source: "pdf",
    text: words,
    finished: true,
  });
  const saved = await findFileText(file.id);
  expect(saved?.truncated).toBe(true);
  expect(saved!.text.length).toBeLessThan(words.length);
  expect(words.startsWith(saved!.text)).toBe(true);
});

it("queues wanted and unread files, then scans, and counts progress", async () => {
  const { owner, add } = await drive();
  const read = await add("read.pdf", "done");
  const unread = await add("unread.pdf");
  const wanted = await add("wanted.pdf");
  await add("trashed.pdf", undefined, { deletedAt: new Date() });
  await wantFileText(wanted.id, owner.id);

  const queue = (
    await listFilesToRead({ limit: 50, skip: [], pdfReader: true })
  )
    .filter((file) => file.ownerUserId === owner.id)
    .map((file) => [file.originalName, file.wanted]);
  expect(queue).toEqual([
    ["wanted.pdf", true],
    ["unread.pdf", false],
  ]);
  expect(await findFileText(wanted.id)).toMatchObject({
    status: "pending",
    current: false,
  });

  await saveFileText(unread, {
    status: "ready",
    source: "pdf",
    text: "first\f\fthird",
    truncated: true,
    ocrPages: [2],
    finished: false,
  });
  const scan = await findFileToScan({
    sources: ["pdf"],
    languages: ["eng"],
    skip: [],
  });
  expect(scan).toMatchObject({ id: unread.id, ocrPages: [2], ocrDone: 0 });
  expect(
    await findFileToScan({ sources: ["image"], languages: ["eng"], skip: [] }),
  ).toBeNull();

  const before = await getFileTextSummary({
    sources: ["pdf"],
    languages: ["eng"],
  });
  await saveScannedPage(scan!, {
    text: "first\fsecond\fthird",
    truncated: false,
    ocrPages: [2],
    ocrDone: 1,
    ocrLanguages: ["eng"],
    finished: true,
  });
  const after = await getFileTextSummary({
    sources: ["pdf"],
    languages: ["eng"],
  });
  expect(after.pagesWaiting).toBe(before.pagesWaiting - 1);
  // The first read cut the text, and a scanned page can't undo that.
  expect(await findFileText(unread.id)).toMatchObject({ truncated: true });
  expect(
    (await getSearchPage(owner.id, "second")).items.map((item) => item.name),
  ).toEqual(["unread.pdf"]);
  // Other languages read the scanned page again.
  expect(
    await findFileToScan({ sources: ["pdf"], languages: ["tur"], skip: [] }),
  ).toMatchObject({ id: unread.id, ocrDone: 1, ocrLanguages: ["eng"] });

  // A scan saved for bytes the file no longer has is dropped.
  await db.file.update({
    where: { id: read.id },
    data: { contentChecksum: "replaced" },
  });
  await saveScannedPage(
    { id: read.id, contentChecksum: "stale", sizeBytes: read.sizeBytes },
    {
      text: "ghost",
      truncated: false,
      ocrPages: [],
      ocrDone: 0,
      ocrLanguages: [],
      finished: true,
    },
  );
  expect((await findFileText(read.id))?.text).toBe("done");
  expect(await getSearchPage(owner.id, "done")).toMatchObject({ total: 0 });
});
