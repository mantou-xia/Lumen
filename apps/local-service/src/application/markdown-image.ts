import { basename } from "node:path";
import type { Readable } from "node:stream";

import type { ReplaceMarkdownImageResponse } from "@lumen/api-contract";

import { imageExtension, prepareImageContent } from "../content/image-media.js";
import { ApplicationError } from "./errors.js";
import type { MarkdownImageApplicationDependencies } from "./ports.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export class MarkdownImageApplication {
  constructor(private readonly dependencies: MarkdownImageApplicationDependencies) {}

  async replace(
    documentId: string,
    revisionId: string,
    resourceId: string,
    originalFilename: string,
    source: Readable,
  ): Promise<ReplaceMarkdownImageResponse> {
    const image = this.dependencies.repository.getImage(documentId, revisionId, resourceId);
    if (image === null || image.state !== "missing") {
      throw new ApplicationError({
        code: "DOCUMENT_NOT_FOUND",
        message: "未找到可替换的缺失图片",
        statusCode: 404,
      });
    }
    const safeFilename = basename(originalFilename);
    if (safeFilename !== originalFilename) {
      throw new ApplicationError({ code: "DOCUMENT_SOURCE_INVALID", message: "图片文件名不能包含目录路径", statusCode: 400 });
    }
    const stagingKey = this.dependencies.fileStore.stagingKey(this.dependencies.ids.generate());
    let storageKey: string | null = null;
    try {
      await this.dependencies.fileStore.writeStagingFile(stagingKey, source);
      const content = await this.dependencies.fileStore.readSource(stagingKey);
      const prepared = prepareImageContent(content);
      if (prepared === null) {
        throw new ApplicationError({ code: "DOCUMENT_SOURCE_INVALID", message: "请选择有效的 PNG、JPEG、GIF、WebP、AVIF 或安全 SVG 图片", statusCode: 400 });
      }
      storageKey = this.dependencies.fileStore.imageStorageKey(
        documentId,
        revisionId,
        resourceId,
        imageExtension(prepared.mediaType),
      );
      await this.dependencies.fileStore.remove(stagingKey);
      const stored = await this.dependencies.fileStore.writeManagedFile(storageKey, prepared.content);
      const replacementHtml = `<img src="/api/resources/${resourceId}" alt="${escapeHtml(image.altText)}" loading="lazy">`;
      const renderHtml = this.dependencies.transaction.run(() => this.dependencies.repository.replaceMissingImage({
        documentId,
        revisionId,
        resourceId,
        originalFilename: safeFilename,
        mediaType: prepared.mediaType,
        storageKey: storageKey!,
        contentHash: stored.contentHash,
        byteSize: stored.byteSize,
        replacementHtml,
      }));
      if (renderHtml === null) throw new Error("缺失图片占位与投影不一致");
      return { resourceId, resourceUrl: `/api/resources/${resourceId}`, renderHtml };
    } catch (error) {
      await this.dependencies.fileStore.remove(stagingKey);
      await this.dependencies.fileStore.remove(storageKey);
      throw error;
    }
  }
}
