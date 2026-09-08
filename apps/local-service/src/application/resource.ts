import type { Readable } from "node:stream";

import { ApplicationError } from "./errors.js";
import type { FileStorePort, ResourceRepositoryPort } from "./ports.js";

export interface ResourceReadResult {
  mediaType: string;
  originalFilename: string;
  byteSize: number;
  range: { start: number; end: number } | null;
  stream: Readable;
}

export class ResourceApplication {
  constructor(
    private readonly repository: ResourceRepositoryPort,
    private readonly fileStore: FileStorePort,
  ) {}

  async read(
    resourceId: string,
    range: { start: number; end: number } | null,
  ): Promise<ResourceReadResult> {
    const resource = this.repository.getResource(resourceId);
    if (resource === null) {
      throw new ApplicationError({
        code: "RESOURCE_NOT_FOUND",
        message: "未找到指定文档资源",
        statusCode: 404,
      });
    }
    if (resource.state !== "committed" || !(await this.fileStore.exists(resource.storageKey))) {
      throw new ApplicationError({
        code: "RESOURCE_UNAVAILABLE",
        message: "文档资源当前不可用",
        statusCode: 409,
      });
    }
    if (range !== null && (
      range.start < 0
      || range.end < range.start
      || range.start >= resource.byteSize
      || range.end >= resource.byteSize
    )) {
      throw new ApplicationError({
        code: "RESOURCE_RANGE_INVALID",
        message: "请求的资源字节范围无效",
        statusCode: 416,
      });
    }

    return {
      mediaType: resource.mediaType,
      originalFilename: resource.originalFilename,
      byteSize: resource.byteSize,
      range,
      stream: this.fileStore.createReadStream(resource.storageKey, range ?? undefined),
    };
  }
}
