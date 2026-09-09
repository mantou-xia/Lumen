import type { OutlineEntry } from "@lumen/api-contract";

export interface OutlineTreeNode {
  entry: OutlineEntry;
  children: OutlineTreeNode[];
}

export function buildOutlineTree(entries: readonly OutlineEntry[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];

  for (const entry of entries.toSorted((left, right) => left.order - right.order)) {
    const node: OutlineTreeNode = { entry, children: [] };
    while (
      stack.length > 0
      && stack[stack.length - 1]!.entry.depth >= entry.depth
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  }

  return roots;
}

export function findActiveOutlineId(
  entries: readonly OutlineEntry[],
  blockOrder: ReadonlyMap<string, number>,
  visibleBlockId: string | undefined,
): string | null {
  const visibleOrder = visibleBlockId === undefined ? -1 : blockOrder.get(visibleBlockId) ?? -1;
  return entries.reduce<string | null>((active, entry) => (
    (blockOrder.get(entry.blockId) ?? Number.POSITIVE_INFINITY) <= visibleOrder
      ? entry.outlineId
      : active
  ), entries[0]?.outlineId ?? null);
}
