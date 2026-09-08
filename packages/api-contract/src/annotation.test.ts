import { describe, expect, it } from "vitest";

import {
  annotationRangeQuerySchema,
  createAnnotationRequestSchema,
} from "./annotation.js";

describe("annotation contract", () => {
  it("为确定性选区标注提供稳定默认值", () => {
    expect(createAnnotationRequestSchema.parse({
      revisionId: "revision-1",
      start: { blockId: "block-1", offset: 2 },
      end: { blockId: "block-1", offset: 8 },
      selectedText: "example",
    })).toMatchObject({
      note: "",
      source: { type: "selection" },
    });
  });

  it("拒绝空可见范围与缺失引用标识的来源", () => {
    expect(() => annotationRangeQuerySchema.parse({
      revisionId: "revision-1",
      blockIds: [],
    })).toThrow();
    expect(() => createAnnotationRequestSchema.parse({
      revisionId: "revision-1",
      start: { blockId: "block-1", offset: 2 },
      end: { blockId: "block-1", offset: 8 },
      selectedText: "example",
      source: { type: "translation" },
    })).toThrow();
  });
});
