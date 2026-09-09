import { describe, expect, it } from "vitest";
import type { OutlineEntry } from "@lumen/api-contract";

import { buildOutlineTree, findActiveOutlineId } from "./outline-tree";

const outline: OutlineEntry[] = [
  { outlineId: "title", blockId: "b0", depth: 1, label: "标题", order: 0 },
  { outlineId: "chapter-a", blockId: "b1", depth: 2, label: "章节 A", order: 1 },
  { outlineId: "detail-a", blockId: "b2", depth: 3, label: "细节 A", order: 2 },
  { outlineId: "chapter-b", blockId: "b4", depth: 2, label: "章节 B", order: 3 },
];

describe("Reader Outline 树", () => {
  it("按 depth 将扁平目录构造成父子树", () => {
    const tree = buildOutlineTree(outline);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((node) => node.entry.outlineId)).toEqual(["chapter-a", "chapter-b"]);
    expect(tree[0]?.children[0]?.children[0]?.entry.outlineId).toBe("detail-a");
  });

  it("根据当前可见语义块定位最近的活动标题", () => {
    const blockOrder = new Map([["b0", 0], ["b1", 1], ["b2", 2], ["b3", 3], ["b4", 4]]);
    expect(findActiveOutlineId(outline, blockOrder, "b3")).toBe("detail-a");
    expect(findActiveOutlineId(outline, blockOrder, "b4")).toBe("chapter-b");
  });
});
