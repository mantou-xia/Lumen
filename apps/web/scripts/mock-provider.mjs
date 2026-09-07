import http from "node:http";

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 4420);
const server = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const recall = body.includes("回忆判断");
    const content = recall
      ? { verdict: "understood", feedback: "你的理解符合当前语境。", contextualMeaning: "用内心体会，而不是只看表面。", missingPoints: [] }
      : { contextualTranslation: "用心去看", contextualMeaning: "在语境中指超越表面观察，用内心体会。", expressionType: "phrase", explanation: "这是一个语境化短语。", uncertainty: "" };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 12, completion_tokens: 18 } }));
  });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
