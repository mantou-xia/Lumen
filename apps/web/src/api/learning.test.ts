import { describe, expect, it, vi } from "vitest";

import {
  archiveLearningContext,
  getLearningExpression,
  getLearningItems,
  updateLearningExpressionStatus,
} from "./learning";

const detail = {
  expressionId: "expression-1",
  canonicalForm: "sophisticated",
  normalizedForm: "sophisticated",
  expressionType: "word",
  status: "active",
  userNote: "",
  lexicalProfile: null,
  lexicalLocalization: null,
  contexts: [],
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

describe("learning API", () => {
  it("将服务端查询条件编码到分页列表请求", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ items: [{
        expressionId: "expression-1",
        canonicalForm: "sophisticated",
        normalizedForm: "sophisticated",
        expressionType: "word",
        status: "familiar",
        userNote: "投资语境",
        stableMeaning: "老练的",
        pronunciation: "/səˈfɪstɪkeɪtɪd/",
        audioUrl: null,
        partsOfSpeech: ["Adjective"],
        latestContext: null,
        contextCount: 2,
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      }],
      nextCursor: "next",
      totalExpressions: 1,
      totalContexts: 2 });
    });

    await expect(getLearningItems({
      query: "投资",
      expressionType: "word",
      status: "familiar",
      sourceDocumentId: "document-1",
      sort: "context_count_desc",
      cursor: "cursor",
      limit: 6,
    }, fetcher)).resolves.toMatchObject({ totalExpressions: 1, totalContexts: 2 });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/learning-items?query=%E6%8A%95%E8%B5%84&expressionType=word&status=familiar&sourceDocumentId=document-1&sort=context_count_desc&cursor=cursor&limit=6",
    );
  });

  it("读取历史版本详情并发送显式状态与归档命令", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json(detail);
    });

    await getLearningExpression("expression-1", "oldest", fetcher);
    await updateLearningExpressionStatus("expression-1", "familiar", fetcher);
    await archiveLearningContext("expression-1", "context-1", fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/learning-items/expression-1?contextSort=oldest",
      { headers: { accept: "application/json" } },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/learning-items/expression-1/status",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "familiar" }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/learning-items/expression-1/contexts/context-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
