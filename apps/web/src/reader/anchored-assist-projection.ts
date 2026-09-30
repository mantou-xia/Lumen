import type {
  AiFootnote,
  AnchoredAssistResult,
  ReadingScene,
  TranslationRangeSummary,
} from "@lumen/api-contract";

type WithoutRelatedResult<Result> = Result extends unknown
  ? Omit<Result, "relatedResult">
  : never;
type UnlinkedAnchoredAssistResult = WithoutRelatedResult<AnchoredAssistResult>;

export function buildAnchoredAssistResults(input: {
  documentId: string;
  sceneId: ReadingScene;
  translations: readonly TranslationRangeSummary[];
  explanations: readonly AiFootnote[];
}): AnchoredAssistResult[] {
  const results: UnlinkedAnchoredAssistResult[] = [
    ...input.translations.map((translation) => ({
      resultId: `translation:${translation.translationId}`,
      resultType: "translation" as const,
      translationId: translation.translationId,
      operationId: translation.operationId,
      documentId: input.documentId,
      revisionId: translation.revisionId,
      selectionFingerprint: translation.fingerprint,
      selectedText: translation.selectedText,
      start: translation.start,
      end: translation.end,
      createdAt: translation.createdAt,
    })),
    ...input.explanations.map((explanation) => ({
      resultId: `explanation:${explanation.footnoteId}`,
      resultType: "explanation" as const,
      footnoteId: explanation.footnoteId,
      conversationId: explanation.conversationId,
      turnId: explanation.turnId,
      capabilityId: explanation.capabilityId,
      documentId: explanation.documentId,
      revisionId: explanation.revisionId,
      selectionFingerprint: explanation.selectionFingerprint,
      selectedText: explanation.selectedText,
      start: explanation.start,
      end: explanation.end,
      createdAt: explanation.createdAt,
    })),
  ];
  const preferredType = input.sceneId === "technical_learning" ? "explanation" : "translation";
  const grouped = new Map<string, UnlinkedAnchoredAssistResult[]>();
  for (const result of results) {
    grouped.set(result.selectionFingerprint, [...(grouped.get(result.selectionFingerprint) ?? []), result]);
  }
  return [...grouped.values()].map((selectionResults) => {
    const primary = selectionResults.find((result) => result.resultType === preferredType)
      ?? selectionResults[0]!;
    const related = selectionResults.find((result) => result.resultType !== primary.resultType);
    return {
      ...primary,
      relatedResult: related === undefined ? null : related.resultType === "translation"
        ? {
            resultId: related.resultId,
            resultType: related.resultType,
            translationId: related.translationId,
            operationId: related.operationId,
          }
        : {
            resultId: related.resultId,
            resultType: related.resultType,
            footnoteId: related.footnoteId,
            conversationId: related.conversationId,
            turnId: related.turnId,
            capabilityId: related.capabilityId,
          },
    };
  });
}
