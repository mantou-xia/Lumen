import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentDebugTrace, AgentDebugTraceSummary } from "@lumen/api-contract";

import { getAgentTrace, listAgentTraces } from "../api/agent-debug";
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  StatusNotice,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "../app/ui";
import {
  agentTraceScopes,
  agentTraceTaskLabel,
  filterAgentTraces,
  type AgentTraceScope,
} from "./agent-trace-filter";
import {
  openWorkspaceDebugChannel,
  type WorkspaceDebugCommand,
  type WorkspaceDebugSnapshot,
} from "./workspace-debug-channel";

export function AgentTestPage() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const selectedTraceIdRef = useRef<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceDebugSnapshot | null>(null);
  const [question, setQuestion] = useState("");
  const [traces, setTraces] = useState<AgentDebugTraceSummary[]>([]);
  const [traceScope, setTraceScope] = useState<AgentTraceScope>("all");
  const [selected, setSelected] = useState<AgentDebugTrace | null>(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const send = (command: WorkspaceDebugCommand) => channelRef.current?.postMessage(command);
  const refresh = async () => {
    const next = await listAgentTraces();
    setTraces(next);
    const preferred = selectedTraceIdRef.current === null
      ? next[0]
      : next.find((item) => item.traceId === selectedTraceIdRef.current) ?? next[0];
    if (preferred !== undefined) {
      selectedTraceIdRef.current = preferred.traceId;
      setSelected(await getAgentTrace(preferred.traceId));
    } else {
      selectedTraceIdRef.current = null;
      setSelected(null);
    }
  };

  useEffect(() => {
    const channel = openWorkspaceDebugChannel();
    channelRef.current = channel;
    if (channel === null) return;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const snapshot = event.data as Partial<WorkspaceDebugSnapshot>;
      if (snapshot.type !== "snapshot") return;
      setWorkspace(snapshot as WorkspaceDebugSnapshot);
      setQuestion(snapshot.question ?? "");
    };
    channel.postMessage({ type: "request_snapshot" } satisfies WorkspaceDebugCommand);
    const heartbeat = window.setInterval(() => channel.postMessage({ type: "request_snapshot" } satisfies WorkspaceDebugCommand), 2_000);
    return () => {
      window.clearInterval(heartbeat);
      channelRef.current = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleTraces = useMemo(
    () => filterAgentTraces(traces, traceScope),
    [traceScope, traces],
  );

  useEffect(() => {
    if (selected === null || visibleTraces.some((trace) => trace.traceId === selected.traceId)) return;
    const first = visibleTraces[0];
    if (first === undefined) {
      selectedTraceIdRef.current = null;
      setSelected(null);
      return;
    }
    selectedTraceIdRef.current = first.traceId;
    void getAgentTrace(first.traceId).then(setSelected).catch((reason) => setError(String(reason)));
  }, [selected, visibleTraces]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: { xs: 1.5, md: 3 } }}>
      <Stack spacing={2} sx={{ maxWidth: 1900, mx: "auto" }}>
        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}>
            <Box>
              <Typography variant="h4">AI Runtime Test</Typography>
              <Typography color="text.secondary">翻译、Workspace、Recall 与词汇任务 · 正式 Runtime Prompt · Provider 原始响应 · SQLite 异常追踪</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Chip color={workspace === null ? "warning" : "success"} label={workspace === null ? "等待阅读页连接" : "Workspace 已连接"} />
              <Button variant="secondary" onClick={() => void refresh()}>刷新 Trace</Button>
            </Stack>
          </Stack>
        </Paper>

        {error !== null && <StatusNotice tone="danger">{error}</StatusNotice>}
        {workspace === null && <StatusNotice tone="warning">尚未连接阅读页，Workspace 实时控制不可用；已经持久化的翻译及其他 AI Trace 仍可正常查看。</StatusNotice>}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, xl: 5 }}>
            <Stack spacing={2}>
              <Paper sx={{ p: 2 }}>
                <Stack spacing={2}>
                  <Typography variant="h6">实时 Workspace 控制面</Typography>
                  <Select
                    fullWidth
                    size="small"
                    disabled={workspace === null || workspace.status === "asking"}
                    value={workspace?.session?.sessionId ?? ""}
                    onChange={(event) => send({ type: "switch_session", sessionId: event.target.value })}
                  >
                    {workspace?.sessions.map((session) => <MenuItem key={session.sessionId} value={session.sessionId}>{session.title}</MenuItem>)}
                  </Select>
                  <Stack direction="row" spacing={1}>
                    <Button disabled={workspace === null || workspace.status === "asking"} onClick={() => send({ type: "create_session" })}>新建会话</Button>
                    <Button variant="secondary" disabled={!workspace?.canReferenceDocument} onClick={() => send({ type: "toggle_reference_mode" })}>
                      {workspace?.referenceMode ? "退出原文引用" : "从原文引用"}
                    </Button>
                  </Stack>
                  <TextField
                    fullWidth
                    multiline
                    minRows={5}
                    label="与阅读页同步的问题草稿"
                    value={question}
                    slotProps={{ htmlInput: { maxLength: 4000 } }}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      send({ type: "set_question", question: event.target.value });
                    }}
                  />
                  <Button disabled={workspace === null || workspace.status === "asking" || question.trim().length === 0} onClick={() => send({ type: "submit" })}>
                    {workspace?.status === "asking" ? "正式调用中…" : "通过 Workspace 发送"}
                  </Button>
                  {workspace?.error !== null && workspace?.error !== undefined && <StatusNotice tone="danger">{workspace.error}</StatusNotice>}
                </Stack>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="h6">本轮真实 References</Typography>
                  {workspace?.pendingReferences.length === 0 && <Typography color="text.secondary">阅读页尚未添加显式引用。</Typography>}
                  {workspace?.pendingReferences.map((reference) => (
                    <Paper key={reference.key} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
                          <Chip label={reference.label} />
                          <Button size="small" color="error" onClick={() => send({ type: "remove_reference", key: reference.key })}>移除</Button>
                        </Stack>
                        <JsonBlock value={reference.input} maxHeight={180} />
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>会话与回答镜像</Typography>
                <JsonBlock value={workspace?.session ?? null} maxHeight={520} />
              </Paper>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, xl: 7 }}>
            <Paper sx={{ p: 2, minHeight: 850 }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mb: 2, justifyContent: "space-between", alignItems: { md: "center" } }}>
                <Box>
                  <Typography variant="h6">正式 AI Runtime Trace</Typography>
                  <Typography color="text.secondary">每次翻译和重试都对应独立 invocation，可通过 operationId 还原同一次用户操作。</Typography>
                </Box>
                <Select
                  aria-label="Trace 任务类型"
                  size="small"
                  value={traceScope}
                  onChange={(event) => setTraceScope(event.target.value as AgentTraceScope)}
                  sx={{ minWidth: 180 }}
                >
                  {agentTraceScopes.map((scope) => (
                    <MenuItem key={scope.value} value={scope.value}>
                      {scope.label}（{filterAgentTraces(traces, scope.value).length}）
                    </MenuItem>
                  ))}
                </Select>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: "auto", pb: 1 }}>
                {visibleTraces.map((trace) => (
                  <Chip
                    key={trace.traceId}
                    color={trace.status === "failed" ? "error" : trace.status === "succeeded" ? "success" : "warning"}
                    label={[
                      agentTraceTaskLabel(trace.taskType),
                      trace.inputPreview ?? trace.traceId.slice(0, 8),
                      new Date(trace.createdAt).toLocaleTimeString("zh-CN", { hour12: false }),
                      trace.status,
                    ].join(" · ")}
                    variant={selected?.traceId === trace.traceId ? "filled" : "outlined"}
                    onClick={() => {
                      selectedTraceIdRef.current = trace.traceId;
                      void getAgentTrace(trace.traceId).then(setSelected).catch((reason) => setError(String(reason)));
                    }}
                  />
                ))}
              </Stack>
              {selected === null ? <Typography color="text.secondary">当前筛选条件下尚无正式 Runtime Trace。请在阅读页触发一次翻译或其他 AI 操作。</Typography> : <TraceViewer trace={selected} tab={tab} onTab={setTab} />}
            </Paper>
          </Grid>
        </Grid>
      </Stack>
    </Box>
  );
}

function TraceViewer({ trace, tab, onTab }: { trace: AgentDebugTrace; tab: number; onTab(value: number): void }) {
  const sections: Array<[string, unknown]> = [
    ["关联概览", { traceId: trace.traceId, operationId: trace.operationId, invocationId: trace.invocationId, taskType: trace.taskType, taskVersion: trace.taskVersion, promptVersion: trace.promptVersion, contextPolicy: trace.contextPolicy, status: trace.status, providerId: trace.providerId, modelId: trace.modelId, latencyMs: trace.latencyMs, inputTokens: trace.inputTokens, outputTokens: trace.outputTokens, finishReason: trace.finishReason, createdAt: trace.createdAt, completedAt: trace.completedAt }],
    ["实际 Provider 请求", trace.actualRequest],
    ["真实系统提示词", trace.systemPrompt],
    ["真实用户提示词", trace.userPrompt],
    ["编译上下文", trace.context],
    ["任务原始入参", trace.metadata.rawInput ?? null],
    ["结构化校验出参", trace.validatedOutput],
    ["引用与运行元数据", { references: trace.references, metadata: trace.metadata }],
    ["模型输出与推理", { output: trace.output, validatedOutput: trace.validatedOutput, reasoning: trace.reasoning, rawResponse: trace.rawResponse }],
    ["异常", { name: trace.errorName, message: trace.errorMessage, stack: trace.errorStack, cause: trace.errorCause }],
    ["完整 Trace", trace],
  ];
  const safeTab = Math.min(tab, sections.length - 1);
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Chip label={`operation ${trace.operationId ?? "-"}`} />
        <Chip label={`invocation ${trace.invocationId ?? "-"}`} />
        <Chip label={trace.status} color={trace.status === "failed" ? "error" : trace.status === "succeeded" ? "success" : "warning"} />
      </Stack>
      <Tabs value={safeTab} onChange={(_event, value: number) => onTab(value)} variant="scrollable" scrollButtons="auto">
        {sections.map(([label]) => <Tab key={label} label={label} />)}
      </Tabs>
      <Divider />
      <JsonBlock value={sections[safeTab]?.[1] ?? trace} maxHeight={560} />
      <Typography variant="h6">按时间排序的执行日志</Typography>
      <Stack spacing={1}>
        {trace.logs.map((log) => (
          <Paper key={log.sequence} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" label={`#${log.sequence}`} />
              <Chip size="small" label={log.level} color={log.level === "error" ? "error" : log.level === "warn" ? "warning" : "default"} />
              <Typography>{log.stage} · {log.message}</Typography>
              <Typography variant="caption" color="text.secondary">{log.createdAt}</Typography>
            </Stack>
            {log.data !== null && <Box sx={{ mt: 1 }}><JsonBlock value={log.data} maxHeight={220} /></Box>}
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function JsonBlock({ value, maxHeight }: { value: unknown; maxHeight: number }) {
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <Box component="pre" sx={{ m: 0, p: 2, maxHeight, overflow: "auto", bgcolor: "var(--reader-code)", borderRadius: 1, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>{content}</Box>;
}
