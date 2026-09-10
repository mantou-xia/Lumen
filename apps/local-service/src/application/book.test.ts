import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBookApplication,
  createLibraryApplication,
  createReaderApplication,
} from "../composition-root.js";
import { openDatabase, type LumenDatabase } from "../infrastructure/database/database.js";
import { ManagedFileStore } from "../infrastructure/files/managed-file-store.js";

const temporaryDirectories: string[] = [];
const databases: LumenDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0).reverse()) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "lumen-book-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "lumen.db"));
  databases.push(database);
  const fileStore = new ManagedFileStore(directory);
  await fileStore.initialize();
  const library = createLibraryApplication(database, fileStore);
  const reader = createReaderApplication(database, fileStore);
  const books = createBookApplication(database, reader);
  const short = await library.importDocument("short.md", Readable.from("# Short\n\n12345"));
  const long = await library.importDocument("long.md", Readable.from("# Long\n\n123456789012345"));
  return { books, database, long: long.document, short: short.document };
}

describe("BookApplication", () => {
  it("允许同一 Document 加入多个 Book，并保持成员身份独立", async () => {
    const { books, short } = await createFixture();

    const first = books.createBook({ title: "First", documentIds: [short.documentId] });
    const second = books.createBook({ title: "Second", documentIds: [short.documentId] });

    expect(first.pages[0]?.document.documentId).toBe(short.documentId);
    expect(second.pages[0]?.document.documentId).toBe(short.documentId);
    expect(first.pages[0]?.pageId).not.toBe(second.pages[0]?.pageId);
    expect(books.listBooks()).toHaveLength(2);
  });

  it("按完整 Page 集合重排，并拒绝缺失 Page 的排序", async () => {
    const { books, long, short } = await createFixture();
    const created = books.createBook({
      title: "Ordered",
      documentIds: [short.documentId, long.documentId],
    });
    const reversed = [...created.pages].reverse().map((page) => page.pageId);

    const reordered = books.reorderPages(created.bookId, { pageIds: reversed });

    expect(reordered.pages.map((page) => page.document.documentId)).toEqual([
      long.documentId,
      short.documentId,
    ]);
    expect(() => books.reorderPages(created.bookId, { pageIds: [reversed[0]!] }))
      .toThrowError(/全部 Page/);
  });

  it("Book Page 进度与单文档及其他 Book 隔离，并按文本长度计算整本进度", async () => {
    const { books, database, long, short } = await createFixture();
    const firstBook = books.createBook({
      title: "Weighted",
      documentIds: [short.documentId, long.documentId],
    });
    const secondBook = books.createBook({ title: "Independent", documentIds: [short.documentId] });
    const firstPage = firstBook.pages[0]!;
    const opened = await books.openBook(firstBook.bookId, firstPage.pageId);
    const block = opened.document.blocks[0]!;

    const saved = books.updateProgress(firstBook.bookId, firstPage.pageId, {
      revisionId: opened.document.revision.revisionId,
      blockId: block.blockId,
      offset: 0,
      progression: 0.5,
    });

    expect(saved.pageProgression).toBe(0.5);
    expect(saved.bookProgression).toBeGreaterThan(0);
    expect(saved.bookProgression).toBeLessThan(0.5);
    expect((await books.openBook(firstBook.bookId)).activePageId).toBe(firstPage.pageId);
    expect((await books.openBook(secondBook.bookId)).document.progress).toBeNull();
    expect(database.connection.prepare(
      "SELECT COUNT(*) AS count FROM reading_progress WHERE document_id = ?",
    ).get(short.documentId)).toEqual({ count: 0 });
  });
});
