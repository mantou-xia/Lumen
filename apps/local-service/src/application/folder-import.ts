import { basename, posix } from "node:path";
import { Readable } from "node:stream";

import type { ImportMarkdownFolderResponse } from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type {
  FolderImportApplicationDependencies,
  FolderImportApplicationPort,
  FolderImportFile,
} from "./ports.js";

function normalizeRelativePath(value: string): string {
  const replaced = value.replaceAll("\\", "/");
  if (replaced.includes("\0") || /^[a-z]:/iu.test(replaced) || replaced.startsWith("/")) {
    throw new ApplicationError({
      code: "DOCUMENT_SOURCE_INVALID",
      message: "文件夹中包含无效的绝对路径",
      statusCode: 400,
    });
  }
  const normalized = posix.normalize(replaced);
  if (
    normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
  ) {
    throw new ApplicationError({
      code: "DOCUMENT_SOURCE_INVALID",
      message: "文件路径不能越过所选文件夹",
      statusCode: 400,
    });
  }
  return normalized;
}

function safeFolderName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== basename(trimmed) || trimmed.includes("\0")) {
    throw new ApplicationError({
      code: "DOCUMENT_SOURCE_INVALID",
      message: "导入文件夹名称无效",
      statusCode: 400,
    });
  }
  return trimmed;
}

export class FolderImportApplication implements FolderImportApplicationPort {
  constructor(private readonly dependencies: FolderImportApplicationDependencies) {}

  async importFolder(folderName: string, files: FolderImportFile[]): Promise<ImportMarkdownFolderResponse> {
    const title = safeFolderName(folderName);
    const containerFiles = new Map<string, Uint8Array>();
    for (const file of files) {
      const path = normalizeRelativePath(file.relativePath);
      if (containerFiles.has(path)) {
        throw new ApplicationError({
          code: "DOCUMENT_SOURCE_INVALID",
          message: `文件夹中存在重复路径：${path}`,
          statusCode: 400,
        });
      }
      containerFiles.set(path, file.content);
    }
    const markdownPaths = [...containerFiles.keys()]
      .filter((path) => path.toLocaleLowerCase().endsWith(".md"))
      .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" }));
    if (markdownPaths.length === 0) {
      throw new ApplicationError({
        code: "DOCUMENT_FORMAT_UNSUPPORTED",
        message: "所选文件夹中没有 Markdown 文件",
        statusCode: 415,
      });
    }

    const importedDocuments: ImportMarkdownFolderResponse["documents"] = [];
    try {
      for (const path of markdownPaths) {
        const content = containerFiles.get(path)!;
        const result = await this.dependencies.library.importDocument(
          posix.basename(path),
          Readable.from([content]),
          "text/markdown",
          { sourcePath: path, files: containerFiles },
        );
        importedDocuments.push(result.document);
      }
      const book = this.dependencies.books.createBook({
        title,
        documentIds: importedDocuments.map((document) => document.documentId),
      });
      return { book, documents: importedDocuments };
    } catch (error) {
      const documentIds = importedDocuments.map((document) => document.documentId);
      const storageKeys = this.dependencies.repository.listDocumentStorageKeys(documentIds);
      this.dependencies.transaction.run(() => {
        for (const documentId of documentIds) {
          this.dependencies.repository.deleteDraftDocument(documentId);
        }
      });
      await Promise.all(storageKeys.map((storageKey) => this.dependencies.fileStore.remove(storageKey)));
      throw error;
    }
  }
}
