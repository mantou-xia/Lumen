import type { RecallMatch, SemanticBlock, TranslationRangeSummary } from "@lumen/api-contract";

export function excludeTranslatedRecallMatches(
  matches: readonly RecallMatch[],
  translations: readonly TranslationRangeSummary[],
  blocks: readonly SemanticBlock[],
): RecallMatch[] {
  const blockOrder = new Map(blocks.map((block) => [block.blockId, block.order]));
  return matches.filter((match) => !translations.some((translation) => (
    translationOverlapsRecall(translation, match, blockOrder)
  )));
}

function translationOverlapsRecall(
  translation: TranslationRangeSummary,
  recall: RecallMatch,
  blockOrder: ReadonlyMap<string, number>,
): boolean {
  const recallOrder = blockOrder.get(recall.blockId);
  const startOrder = blockOrder.get(translation.start.blockId);
  const endOrder = blockOrder.get(translation.end.blockId);
  if (recallOrder === undefined || startOrder === undefined || endOrder === undefined) return false;
  if (recallOrder < startOrder || recallOrder > endOrder) return false;
  if (startOrder === endOrder) {
    return recall.startOffset < translation.end.offset
      && recall.endOffset > translation.start.offset;
  }
  if (recallOrder === startOrder) return recall.endOffset > translation.start.offset;
  if (recallOrder === endOrder) return recall.startOffset < translation.end.offset;
  return true;
}
