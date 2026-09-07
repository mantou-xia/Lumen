import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ApplicationError } from "../../application/errors.js";

const maxMarkdownBytes = 10 * 1024 * 1024;

export interface StoredFileInfo {
  byteSize: number;
  contentHash: string;
}

export class ManagedFileStore {
  constructor(private readonly rootDirectory: string) {}

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.resolveStorageKey("staging"), { recursive: true }),
      mkdir(this.resolveStorageKey("documents"), { recursive: true }),
    ]);
  }

  stagingKey(operationId: string): string {
    return `staging/${operationId}.upload`;
  }

  sourceStorageKey(documentId: string, resourceId: string): string {
    return `documents/${documentId}/source/${resourceId}.md`;
  }

  async writeStagingFile(storageKey: string, source: Readable): Promise<StoredFileInfo> {
    const destination = this.resolveStorageKey(storageKey);
    await mkdir(dirname(destination), { recursive: true });

    const hash = createHash("sha256");
    let byteSize = 0;
    const observer = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > maxMarkdownBytes) {
          callback(
            new ApplicationError({
              code: "DOCUMENT_SOURCE_TOO_LARGE",
              message: "Markdown 文件不能超过 10 MiB",
              statusCode: 413,
            }),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, observer, createWriteStream(destination, { flags: "wx" }));
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }

    if (byteSize === 0) {
      await rm(destination, { force: true });
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "不能导入空 Markdown 文件",
        statusCode: 400,
      });
    }

    return { byteSize, contentHash: hash.digest("hex") };
  }

  async validateMarkdown(storageKey: string): Promise<string> {
    const content = await readFile(this.resolveStorageKey(storageKey));
    let markdown: string;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch (error) {
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "Markdown 文件必须使用有效的 UTF-8 编码",
        statusCode: 400,
        cause: error,
      });
    }

    if (content.includes(0)) {
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "Markdown 文件包含无效的二进制内容",
        statusCode: 400,
      });
    }

    return markdown;
  }

  async promote(stagingKey: string, storageKey: string): Promise<void> {
    const source = this.resolveStorageKey(stagingKey);
    const destination = this.resolveStorageKey(storageKey);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolveStorageKey(storageKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  createReadStream(storageKey: string): Readable {
    return createReadStream(this.resolveStorageKey(storageKey));
  }

  async remove(storageKey: string | null): Promise<void> {
    if (storageKey !== null) {
      await rm(this.resolveStorageKey(storageKey), { force: true });
    }
  }

  async cleanupStaging(): Promise<void> {
    const stagingDirectory = this.resolveStorageKey("staging");
    await rm(stagingDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
  }

  private resolveStorageKey(storageKey: string): string {
    if (storageKey.length === 0 || isAbsolute(storageKey) || storageKey.includes("\0")) {
      throw new Error("无效的 Managed Filesystem storageKey");
    }

    const normalizedKey = storageKey.replaceAll("/", sep);
    const target = resolve(this.rootDirectory, normalizedKey);
    const targetRelativePath = relative(resolve(this.rootDirectory), target);
    if (
      targetRelativePath === ".." ||
      targetRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(targetRelativePath)
    ) {
      throw new Error("Managed Filesystem storageKey 超出数据目录");
    }

    return target;
  }
}

export function isMarkdownFilename(filename: string): boolean {
  return extname(filename).toLowerCase() === ".md";
}
