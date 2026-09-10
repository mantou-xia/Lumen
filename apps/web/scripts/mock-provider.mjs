import http from "node:http";

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 4420);
let invocationCount = 0;
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ invocationCount }));
    return;
  }
  invocationCount += 1;
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const recall = body.includes("回忆判断");
    const workspace = body.includes("受控阅读上下文助手");
    const queryRewrite = body.includes("SQLite FTS5");
    const payload = JSON.parse(body);
    const userMessage = payload.messages.find((message) => message.role === "user")?.content ?? "{}";
    const userInput = JSON.parse(userMessage);
    const selectedText = recall || workspace || queryRewrite ? "" : userInput.selectedText;
    const citedReference = workspace ? userInput.references[0] : undefined;
    const insufficientEvidence = workspace && userInput.question.includes("文档没有的信息");
    const content = queryRewrite
      ? { query: userInput.question }
      : workspace
      ? insufficientEvidence
        ? {
            content: "当前文档没有提供回答这个问题所需的依据。",
            citationReferenceIds: [],
            outcome: "insufficient_evidence",
          }
        : {
            content: citedReference === undefined
              ? "这处表达强调理解不能脱离当前阅读语境。"
              : `这处表达强调理解不能脱离当前阅读语境。[查看来源](lumen-reference:${citedReference.referenceId})`,
            citationReferenceIds: citedReference === undefined ? [] : [citedReference.referenceId],
            outcome: "answered",
          }
      : recall
      ? { verdict: "understood", feedback: "你的理解符合当前语境。", contextualMeaning: "用内心体会，而不是只看表面。", missingPoints: [] }
      : {
          contextualTranslation: selectedText === "We learn"
            ? "我们学会"
            : selectedText === "appearances"
              ? "表象"
              : "用心去看",
          contextualMeaning: "在当前阅读语境中的含义。",
          expressionType: "phrase",
          explanation: "这是一个语境化短语。",
          uncertainty: "",
        };
    const delay = selectedText === "We learn" ? 300 : 0;
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 12, completion_tokens: 18 } }));
    }, delay);
  });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
