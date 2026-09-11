import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ApplicationError } from "../../application/errors.js";

const maxDocumentBytes = 10 * 1024 * 1024;

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

  sourceStorageKey(documentId: string, resourceId: string, extension: string): string {
    if (!/^\.[a-z0-9]+$/i.test(extension)) {
      throw new Error("无效的受管来源文件扩展名");
    }
    return `documents/${documentId}/source/${resourceId}${extension.toLowerCase()}`;
  }

  imageStorageKey(
    documentId: string,
    revisionId: string,
    resourceId: string,
    extension: string,
  ): string {
    if (!/^\.[a-z0-9]+$/i.test(extension)) {
      throw new Error("无效的受管图片扩展名");
    }
    return `documents/${documentId}/revisions/${revisionId}/images/${resourceId}${extension.toLowerCase()}`;
  }

  async writeStagingFile(storageKey: string, source: Readable): Promise<StoredFileInfo> {
    const destination = this.resolveStorageKey(storageKey);
    await mkdir(dirname(destination), { recursive: true });

    const hash = createHash("sha256");
    let byteSize = 0;
    const observer = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > maxDocumentBytes) {
          callback(
            new ApplicationError({
              code: "DOCUMENT_SOURCE_TOO_LARGE",
              message: "文档文件不能超过 10 MiB",
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
        message: "不能导入空文档文件",
        statusCode: 400,
      });
    }

    return { byteSize, contentHash: hash.digest("hex") };
  }

  async writeManagedFile(storageKey: string, content: Uint8Array): Promise<StoredFileInfo> {
    if (content.byteLength === 0 || content.byteLength > maxDocumentBytes) {
      throw new ApplicationError({
        code: content.byteLength === 0 ? "DOCUMENT_SOURCE_INVALID" : "DOCUMENT_SOURCE_TOO_LARGE",
        message: content.byteLength === 0 ? "图片文件不能为空" : "图片文件不能超过 10 MiB",
        statusCode: content.byteLength === 0 ? 400 : 413,
      });
    }
    const destination = this.resolveStorageKey(storageKey);
    await mkdir(dirname(destination), { recursive: true });
    const hash = createHash("sha256").update(content).digest("hex");
    try {
      await writeFile(destination, content, { flag: "wx" });
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
    return { byteSize: content.byteLength, contentHash: hash };
  }

  async readSource(storageKey: string): Promise<Uint8Array> {
    return readFile(this.resolveStorageKey(storageKey));
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

  createReadStream(storageKey: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.resolveStorageKey(storageKey), range);
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
