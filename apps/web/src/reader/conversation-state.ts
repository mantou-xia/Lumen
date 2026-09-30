import type { ConversationTurn, ReadingConversation } from "@lumen/api-contract";

export interface LatestRequestToken {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly targetId: string;
}

export interface LatestRequestController {
  begin(targetId: string): LatestRequestToken;
  invalidate(): void;
  isCurrent(token: LatestRequestToken): boolean;
}

export interface SynchronousRequestGuard {
  release(): void;
  tryAcquire(): boolean;
}

export function createSynchronousRequestGuard(): SynchronousRequestGuard {
  let inFlight = false;
  return {
    release() {
      inFlight = false;
    },
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
  };
}

export function createLatestRequestController(): LatestRequestController {
  let generation = 0;
  let activeController: AbortController | null = null;

  return {
    begin(targetId) {
      activeController?.abort();
      activeController = new AbortController();
      generation += 1;
      return { generation, signal: activeController.signal, targetId };
    },
    invalidate() {
      activeController?.abort();
      activeController = null;
      generation += 1;
    },
    isCurrent(token) {
      return token.generation === generation && !token.signal.aborted;
    },
  };
}

export function mergeConversationTurn(
  conversation: ReadingConversation | null,
  conversationId: string,
  turn: ConversationTurn,
): ReadingConversation | null {
  if (conversation === null || conversation.conversationId !== conversationId) return conversation;

  const existingTurnIndex = conversation.turns.findIndex((item) => item.turnId === turn.turnId);
  const turns = existingTurnIndex < 0
    ? [...conversation.turns, turn]
    : conversation.turns.map((item, index) => index === existingTurnIndex ? turn : item);
  const currentFootnote = turn.footnote === null ? undefined : conversation.footnotes.find((item) => (
    item.selectionFingerprint === turn.footnote!.selectionFingerprint
    && item.capabilityId === turn.footnote!.capabilityId
  ));
  const keepNewerFootnote = turn.footnote !== null
    && currentFootnote !== undefined
    && currentFootnote.updatedAt > turn.footnote.updatedAt;
  const footnotes = turn.footnote === null || keepNewerFootnote
    ? conversation.footnotes
    : [
        ...conversation.footnotes.filter((item) => (
          item.footnoteId !== turn.footnote!.footnoteId
          && (
            item.selectionFingerprint !== turn.footnote!.selectionFingerprint
            || item.capabilityId !== turn.footnote!.capabilityId
          )
        )),
        turn.footnote,
      ];

  return {
    ...conversation,
    turns,
    footnotes,
    updatedAt: conversation.updatedAt > turn.answer.createdAt
      ? conversation.updatedAt
      : turn.answer.createdAt,
  };
}
