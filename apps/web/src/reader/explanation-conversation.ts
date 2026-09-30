import type { AiFootnote, ConversationTurn, ReadingConversation } from "@lumen/api-contract";

export function findFootnoteConversation(
  footnote: AiFootnote,
  conversations: readonly (ReadingConversation | null | undefined)[],
): { conversation: ReadingConversation; turn: ConversationTurn } | null {
  for (const conversation of conversations) {
    if (conversation?.conversationId !== footnote.conversationId) continue;
    const turn = conversation.turns.find((candidate) => candidate.turnId === footnote.turnId);
    if (turn !== undefined) return { conversation, turn };
  }
  return null;
}
