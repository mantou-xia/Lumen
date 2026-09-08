import type { SourceMapping } from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { SourceMappingRepositoryPort } from "./ports.js";

export class SourceMappingApplication {
  constructor(private readonly repository: SourceMappingRepositoryPort) {}

  fromSemanticPoint(revisionId: string, blockId: string, offset: number): SourceMapping[] {
    return this.requireMappings(
      this.repository.findBySemanticPoint(revisionId, blockId, offset),
    );
  }

  fromSourceOffset(revisionId: string, sourceOffset: number): SourceMapping[] {
    return this.requireMappings(this.repository.findBySourceOffset(revisionId, sourceOffset));
  }

  private requireMappings(mappings: SourceMapping[]): SourceMapping[] {
    if (mappings.length === 0) {
      throw new ApplicationError({
        code: "SOURCE_MAPPING_NOT_FOUND",
        message: "指定位置没有可用的 Source Mapping",
        statusCode: 404,
      });
    }
    return mappings;
  }
}
