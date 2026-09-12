import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentDebugTrace,
  AgentDebugTraceSummary,
  DailyReadingWorkflowTrace,
  DailyReadingWorkflowTraceSummary,
} from "@lumen/api-contract";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  TerminalSquare,
  Workflow,
  Wrench,
} from "lucide-react";

import {
  getAgentTrace,
  getDailyReadingWorkflowTrace,
  listAgentTraces,
  listDailyReadingWorkflowTraces,
} from "../api/agent-debug";
import { AppIcon } from "../app/AppIcon";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  Grid,
  InputAdornment,
  LinearProgress,
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
import { agentTraceScopes, type AgentTraceScope } from "./agent-trace-filter";
import {
  buildExecutionList,
  buildOperationSteps,
  buildWorkflowSteps,
  diagnoseAgentTrace,
  diagnoseWorkflow,
  executionStatusLabel,
  executionStatusTone,
  filterExecutionList,
  preferredTraceId,
  type ExecutionDiagnosis,
  type ExecutionListItem,
  type ExecutionStatus,
  type ExecutionStep,
} from "./agent-trace-view-model";
import {
  openWorkspaceDebugChannel,
  type WorkspaceDebugCommand,
  type WorkspaceDebugSnapshot,
} from "./workspace-debug-channel";

type StatusFilter = "all" | ExecutionStatus;

export function AgentTestPage() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const historyInitializedRef = useRef(false);
  const [workspace, setWorkspace] = useState<WorkspaceDebugSnapshot | null>(null);
  const [question, setQuestion] = useState("");
  const [traces, setTraces] = useState<AgentDebugTraceSummary[]>([]);
  const [workflows, setWorkflows] = useState<DailyReadingWorkflowTraceSummary[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<DailyReadingWorkflowTrace | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<AgentDebugTrace | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [scope, setScope] = useState<AgentTraceScope>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [inspectorTab, setInspectorTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [traceCursor, setTraceCursor] = useState<string | null>(null);
  const [workflowCursor, setWorkflowCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (command: WorkspaceDebugCommand) => channelRef.current?.postMessage(command);
  const refresh = async () => {
    const [tracePage, workflowPage] = await Promise.all([
      listAgentTraces(),
      listDailyReadingWorkflowTraces(),
    ]);
    if (!historyInitializedRef.current) {
      historyInitializedRef.current = true;
      setTraceCursor(tracePage.nextCursor);
      setWorkflowCursor(workflowPage.nextCursor);
    }
    setTraces((current) => mergeHistory(tracePage.traces, current, (item) => item.traceId));
    setWorkflows((current) => mergeHistory(workflowPage.traces, current, (item) => item.runId));
    setError(null);
    setLoading(false);
  };
  const loadOlder = async () => {
    setLoadingOlder(true);
    try {
      const [tracePage, workflowPage] = await Promise.all([
        traceCursor === null ? null : listAgentTraces(traceCursor),
        workflowCursor === null ? null : listDailyReadingWorkflowTraces(workflowCursor),
      ]);
      if (tracePage !== null) {
        setTraces((current) => mergeHistory(current, tracePage.traces, (item) => item.traceId));
        setTraceCursor(tracePage.nextCursor);
      }
      if (workflowPage !== null) {
        setWorkflows((current) => mergeHistory(current, workflowPage.traces, (item) => item.runId));
        setWorkflowCursor(workflowPage.nextCursor);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingOlder(false);
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
    const heartbeat = window.setInterval(
      () => channel.postMessage({ type: "request_snapshot" } satisfies WorkspaceDebugCommand),
      2_000,
    );
    return () => {
      window.clearInterval(heartbeat);
      channelRef.current = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    void refresh().catch((reason) => {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const executions = useMemo(() => buildExecutionList(traces, workflows), [traces, workflows]);
  const visibleExecutions = useMemo(
    () => filterExecutionList(executions, scope, status, query),
    [executions, query, scope, status],
  );
  const selectedExecution = useMemo(
    () => visibleExecutions.find((item) => item.id === selectedExecutionId) ?? visibleExecutions[0] ?? null,
    [selectedExecutionId, visibleExecutions],
  );

  useEffect(() => {
    if (selectedExecution === null) {
      setSelectedExecutionId(null);
      return;
    }
    if (selectedExecution.id !== selectedExecutionId) setSelectedExecutionId(selectedExecution.id);
  }, [selectedExecution, selectedExecutionId]);

  useEffect(() => {
    setSelectedWorkflow(null);
    setSelectedTrace(null);
    setSelectedStepId(null);
    setInspectorTab(0);
  }, [selectedExecution?.id]);

  useEffect(() => {
    let cancelled = false;
    if (selectedExecution?.kind !== "daily-reading-workflow" || selectedExecution.runId === null) return;
    void getDailyReadingWorkflowTrace(selectedExecution.runId)
      .then((trace) => {
        if (!cancelled) setSelectedWorkflow(trace);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedExecution?.id, selectedExecution?.kind, selectedExecution?.runId, workflows]);

  const relatedTraceSummaries = useMemo(() => {
    if (selectedExecution === null) return [];
    const ids = new Set(selectedExecution.traceIds);
    return traces.filter((trace) => ids.has(trace.traceId));
  }, [selectedExecution, traces]);

  const steps = useMemo(() => {
    if (selectedExecution === null) return [];
    if (selectedExecution.kind === "daily-reading-workflow") {
      return selectedWorkflow === null ? [] : buildWorkflowSteps(selectedWorkflow, relatedTraceSummaries);
    }
    return buildOperationSteps(relatedTraceSummaries);
  }, [relatedTraceSummaries, selectedExecution, selectedWorkflow]);

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [selectedStepId, steps],
  );

  useEffect(() => {
    if (steps.length === 0) return;
    if (steps.some((step) => step.id === selectedStepId)) return;
    setSelectedStepId(choosePreferredStepId(steps, relatedTraceSummaries));
  }, [relatedTraceSummaries, selectedStepId, steps]);

  useEffect(() => {
    let cancelled = false;
    if (selectedStep?.traceId === null || selectedStep?.traceId === undefined) {
      setSelectedTrace(null);
      return;
    }
    void getAgentTrace(selectedStep.traceId)
      .then((trace) => {
        if (!cancelled) setSelectedTrace(trace);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStep?.traceId, traces]);

  const diagnosis = selectedExecution?.kind === "daily-reading-workflow" && selectedWorkflow !== null
    ? diagnoseWorkflow(selectedWorkflow)
    : selectedExecution === null ? null : diagnoseOperation(selectedExecution, relatedTraceSummaries);
  const metrics = summarizeExecutions(executions);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: { xs: 1.5, md: 3 } }}>
      <Stack spacing={2} sx={{ maxWidth: 1920, mx: "auto" }}>
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <AppIcon icon={Activity} size={25} />
                <Typography variant="h4">Agent 执行追踪</Typography>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                从任务到步骤再到输入输出，定位黑箱执行中真正失败或需要优化的位置。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Chip
                color={workspace === null ? "warning" : "success"}
                label={workspace === null ? "阅读页未连接" : "阅读页已连接"}
                variant="outlined"
              />
              <Button variant="secondary" startIcon={<AppIcon icon={RefreshCw} size={16} />} onClick={() => void refresh()}>
                刷新
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {loading && <LinearProgress aria-label="正在加载执行记录" />}
        {error !== null && <StatusNotice tone="danger">{error}</StatusNotice>}

        <Grid container spacing={1.5}>
          <MetricCard icon={Activity} label="全部任务" value={metrics.total} detail="按用户操作或 Workflow 聚合" />
          <MetricCard icon={CheckCircle2} label="成功" value={metrics.succeeded} detail="已走完预期执行链" tone="success" />
          <MetricCard icon={AlertTriangle} label="失败 / 需关注" value={metrics.problematic} detail="优先检查失败步骤" tone="warning" />
          <MetricCard icon={Clock3} label="执行中" value={metrics.running} detail="页面每秒自动更新" tone="info" />
        </Grid>

        <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
          <Grid size={{ xs: 12, lg: 4, xl: 3 }}>
            <Paper sx={{ height: { lg: "calc(100vh - 250px)" }, minHeight: 650, display: "flex", flexDirection: "column" }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="h6">执行任务</Typography>
                <Typography variant="body2" color="text.secondary">一次用户动作或一次自动化运行只显示一条。</Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="搜索任务、输入或 ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  sx={{ mt: 2 }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size={16} /></InputAdornment> } }}
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                  <Select
                    aria-label="任务类型"
                    fullWidth
                    size="small"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as AgentTraceScope)}
                  >
                    {agentTraceScopes.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                  </Select>
                  <Select
                    aria-label="任务状态"
                    fullWidth
                    size="small"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as StatusFilter)}
                  >
                    <MenuItem value="all">全部状态</MenuItem>
                    <MenuItem value="failed">失败</MenuItem>
                    <MenuItem value="warning">需关注</MenuItem>
                    <MenuItem value="running">执行中</MenuItem>
                    <MenuItem value="succeeded">成功</MenuItem>
                  </Select>
                </Stack>
              </Box>
              <Divider />
              <Box sx={{ overflowY: "auto", flex: 1, p: 1 }}>
                {visibleExecutions.length === 0
                  ? <Typography color="text.secondary" sx={{ p: 2 }}>当前筛选条件下没有执行记录。</Typography>
                  : visibleExecutions.map((item) => (
                    <ExecutionListRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedExecution?.id}
                      onClick={() => setSelectedExecutionId(item.id)}
                    />
                  ))}
                {(traceCursor !== null || workflowCursor !== null) && (
                  <Button fullWidth variant="secondary" disabled={loadingOlder} onClick={() => void loadOlder()}>
                    {loadingOlder ? "正在加载…" : "加载更早记录"}
                  </Button>
                )}
              </Box>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, lg: 8, xl: 5 }}>
            <Paper sx={{ height: { lg: "calc(100vh - 250px)" }, minHeight: 650, display: "flex", flexDirection: "column" }}>
              {selectedExecution === null ? (
                <EmptyTraceState />
              ) : (
                <>
                  <Box sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <Box>
                        <Typography variant="h6">{selectedExecution.title}</Typography>
                        <Typography variant="body2" color="text.secondary">{selectedExecution.subtitle}</Typography>
                      </Box>
                      <StatusChip status={selectedExecution.status} />
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }}>
                      <Chip size="small" variant="outlined" label={`${selectedExecution.stepCount} 个持久化步骤`} />
                      <Chip size="small" variant="outlined" label={`${selectedExecution.traceIds.length} 次 Agent 调用`} />
                      <Chip size="small" variant="outlined" label={formatDuration(selectedExecution.createdAt, selectedExecution.completedAt)} />
                    </Stack>
                  </Box>
                  {diagnosis !== null && <DiagnosisBanner diagnosis={diagnosis} />}
                  <Divider />
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography variant="subtitle1">执行路径</Typography>
                    <Typography variant="body2" color="text.secondary">按真实写入时间排列；选择任一步骤查看当时的证据。</Typography>
                  </Box>
                  <Box sx={{ overflowY: "auto", flex: 1, px: 1.25, pb: 1.5 }}>
                    {steps.length === 0
                      ? <Typography color="text.secondary" sx={{ p: 2 }}>正在加载步骤，或该任务尚未写入阶段记录。</Typography>
                      : steps.map((step, index) => (
                        <StepLedgerRow
                          key={step.id}
                          step={step}
                          isLast={index === steps.length - 1}
                          selected={step.id === selectedStepId}
                          onClick={() => {
                            setSelectedStepId(step.id);
                            setInspectorTab(0);
                          }}
                        />
                      ))}
                  </Box>
                </>
              )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, xl: 4 }}>
            <Paper sx={{ height: { xl: "calc(100vh - 250px)" }, minHeight: 650, display: "flex", flexDirection: "column" }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="h6">步骤检查器</Typography>
                <Typography variant="body2" color="text.secondary">这里只显示当前选中步骤，不需要在整份 Trace 中寻找字段。</Typography>
              </Box>
              <Divider />
              <Box sx={{ overflowY: "auto", flex: 1 }}>
                {selectedStep === null
                  ? <Typography color="text.secondary" sx={{ p: 2 }}>请先选择一个执行步骤。</Typography>
                  : selectedStep.kind === "agent-invocation"
                    ? selectedTrace?.traceId === selectedStep.traceId
                      ? <AgentStepInspector trace={selectedTrace} tab={inspectorTab} onTab={setInspectorTab} />
                      : <Typography color="text.secondary" sx={{ p: 2 }}>正在加载该 Agent 调用的证据…</Typography>
                    : <WorkflowStepInspector step={selectedStep} />}
              </Box>
            </Paper>
          </Grid>
        </Grid>

        <WorkspaceTriggerPanel workspace={workspace} question={question} setQuestion={setQuestion} send={send} />
      </Stack>
    </Box>
  );
}

function MetricCard({ icon, label, value, detail, tone = "neutral" }: {
  icon: typeof Activity;
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  const color = tone === "success" ? "success.main" : tone === "warning" ? "warning.main" : tone === "info" ? "info.main" : "text.primary";
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Paper sx={{ p: 1.75, height: "100%" }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <Box sx={{ color, display: "flex" }}><AppIcon icon={icon} size={20} /></Box>
          <Box>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="h5">{value}</Typography>
          </Box>
        </Stack>
        <Typography variant="caption" color="text.secondary">{detail}</Typography>
      </Paper>
    </Grid>
  );
}

function ExecutionListRow({ item, selected, onClick }: { item: ExecutionListItem; selected: boolean; onClick(): void }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        display: "block",
        textAlign: "left",
        borderRadius: 1.5,
        px: 1.5,
        py: 1.25,
        mb: 0.75,
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "transparent",
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ mt: 0.25, color: item.kind === "daily-reading-workflow" ? "secondary.main" : "text.secondary" }}>
          <AppIcon icon={item.kind === "daily-reading-workflow" ? Workflow : Bot} size={18} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="subtitle2" noWrap>{item.title}</Typography>
            <StatusDot status={item.status} />
          </Stack>
          <Typography variant="body2" color="text.secondary" noWrap>{item.subtitle}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">{formatTimestamp(item.createdAt)}</Typography>
            <Typography variant="caption" color="text.secondary">{item.stepCount} 步</Typography>
          </Stack>
        </Box>
        <AppIcon icon={ChevronRight} size={16} />
      </Stack>
    </ButtonBase>
  );
}

function DiagnosisBanner({ diagnosis }: { diagnosis: ExecutionDiagnosis }) {
  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <StatusNotice tone={diagnosis.tone}>
        <Typography variant="subtitle2">{diagnosis.title}</Typography>
        <Typography variant="body2">{diagnosis.summary}</Typography>
        <Typography variant="caption" component="div" sx={{ mt: 0.75 }}>当前定位：{diagnosis.focus}</Typography>
        {diagnosis.suggestions.map((suggestion) => (
          <Typography key={suggestion} variant="caption" component="div">排查建议：{suggestion}</Typography>
        ))}
      </StatusNotice>
    </Box>
  );
}

function StepLedgerRow({ step, isLast, selected, onClick }: {
  step: ExecutionStep;
  isLast: boolean;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <ButtonBase onClick={onClick} sx={{ width: "100%", display: "block", textAlign: "left", borderRadius: 1.5 }}>
      <Stack direction="row" spacing={1.25}>
        <Stack sx={{ alignItems: "center", width: 28, flexShrink: 0 }}>
          <Box sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: selected ? "primary.main" : statusBackground(step.status),
            color: selected ? "primary.contrastText" : statusForeground(step.status),
            fontSize: 12,
            fontWeight: 700,
          }}>{step.sequence}</Box>
          {!isLast && <Box sx={{ width: 2, minHeight: 42, flex: 1, bgcolor: "divider" }} />}
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0, p: 1.25, mb: 0.75, border: "1px solid", borderColor: selected ? "primary.main" : "divider", borderRadius: 1.5, bgcolor: selected ? "action.selected" : "transparent" }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="subtitle2">{step.title}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              {step.kind === "agent-invocation" && <Chip size="small" label="Agent" variant="outlined" />}
              <StatusChip status={step.status} size="small" />
            </Stack>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{step.summary}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">{step.stage}</Typography>
            <Typography variant="caption" color="text.secondary">{formatTimestamp(step.createdAt)}</Typography>
          </Stack>
        </Box>
      </Stack>
    </ButtonBase>
  );
}

function AgentStepInspector({ trace, tab, onTab }: { trace: AgentDebugTrace; tab: number; onTab(value: number): void }) {
  const diagnosis = diagnoseAgentTrace(trace);
  const sections: Array<{ label: string; value: unknown }> = [
    { label: "概览", value: null },
    { label: "输入", value: { rawInput: trace.metadata.rawInput ?? null, context: trace.context, references: trace.references } },
    { label: "Prompt", value: { systemPrompt: trace.systemPrompt, userPrompt: trace.userPrompt } },
    { label: "输出", value: { validatedOutput: trace.validatedOutput, output: trace.output, reasoning: trace.reasoning } },
    { label: "错误", value: { name: trace.errorName, message: trace.errorMessage, cause: trace.errorCause, stack: trace.errorStack } },
    { label: "实际请求", value: { actualRequest: trace.actualRequest, rawResponse: trace.rawResponse } },
    { label: "原始数据", value: trace },
  ];
  const safeTab = Math.min(tab, sections.length - 1);
  return (
    <Stack spacing={0}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box>
            <Typography variant="subtitle1">{trace.taskType ?? "未知 Agent 任务"}</Typography>
            <Typography variant="body2" color="text.secondary">{trace.providerId} / {trace.modelId}</Typography>
          </Box>
          <StatusChip status={trace.status} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }}>
          <Chip size="small" variant="outlined" label={`${trace.latencyMs ?? "-"} ms`} />
          <Chip size="small" variant="outlined" label={`输入 ${trace.inputTokens ?? "-"} tokens`} />
          <Chip size="small" variant="outlined" label={`输出 ${trace.outputTokens ?? "-"} tokens`} />
          <Chip size="small" variant="outlined" label={`Prompt ${trace.promptVersion ?? "-"}`} />
        </Stack>
      </Box>
      <Tabs value={safeTab} onChange={(_event, value: number) => onTab(value)} variant="scrollable" scrollButtons="auto" sx={{ px: 1 }}>
        {sections.map((section) => <Tab key={section.label} label={section.label} />)}
      </Tabs>
      <Divider />
      {safeTab === 0 ? (
        <Stack spacing={2} sx={{ p: 2 }}>
          <StatusNotice tone={diagnosis.tone}>
            <Typography variant="subtitle2">{diagnosis.title}</Typography>
            <Typography variant="body2">{diagnosis.summary}</Typography>
          </StatusNotice>
          <KeyValueList values={{
            "Operation ID": trace.operationId,
            "Invocation ID": trace.invocationId,
            "任务版本": trace.taskVersion,
            "上下文策略": trace.contextPolicy,
            "结束原因": trace.finishReason,
            "创建时间": formatTimestamp(trace.createdAt),
            "完成时间": trace.completedAt === null ? null : formatTimestamp(trace.completedAt),
          }} />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>调用内阶段日志</Typography>
            {trace.logs.length === 0
              ? <Typography variant="body2" color="text.secondary">该调用没有记录阶段日志。</Typography>
              : <Stack spacing={1}>{trace.logs.map((log) => (
                <Accordion key={log.sequence} disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider" }}>
                  <AccordionSummary expandIcon={<AppIcon icon={ChevronRight} size={16} />}>
                  <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <StatusDot status={log.level === "error" ? "failed" : log.level === "warn" ? "warning" : "succeeded"} />
                    <Typography variant="subtitle2">{log.stage}</Typography>
                    <Typography variant="caption" color="text.secondary">#{log.sequence}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{log.message}</Typography>
                  </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography variant="caption" color="text.secondary">{formatTimestamp(log.createdAt)}</Typography>
                    <JsonBlock value={log.data} maxHeight={280} padded={false} />
                  </AccordionDetails>
                </Accordion>
              ))}</Stack>}
          </Box>
        </Stack>
      ) : safeTab === 2 ? (
        <Stack spacing={2} sx={{ p: 2 }}>
          <EvidenceSection title="系统提示词 · 顶层约束" value={trace.systemPrompt} />
          <EvidenceSection title="用户提示词 · 本次任务内容" value={trace.userPrompt} />
        </Stack>
      ) : safeTab === 3 ? (
        <Stack spacing={2} sx={{ p: 2 }}>
          <EvidenceSection title="已校验的结构化结果" value={trace.validatedOutput} />
          <EvidenceSection title="模型原始文本" value={trace.output} />
          <EvidenceSection title="Provider 明确返回的 reasoning（非隐藏思维链）" value={trace.reasoning} />
        </Stack>
      ) : <JsonBlock value={sections[safeTab]?.value ?? null} maxHeight={620} />}
    </Stack>
  );
}

function WorkflowStepInspector({ step }: { step: ExecutionStep }) {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <Box>
          <Typography variant="subtitle1">{step.title}</Typography>
          <Typography variant="body2" color="text.secondary">{step.stage}</Typography>
        </Box>
        <StatusChip status={step.status} />
      </Stack>
      <StatusNotice tone={executionStatusTone(step.status)}>{step.summary}</StatusNotice>
      <KeyValueList values={{
        "顺序": `#${step.sequence}`,
        "记录时间": formatTimestamp(step.createdAt),
        "证据类型": "Workflow 持久化事件",
      }} />
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>阶段数据</Typography>
        <JsonBlock value={step.data} maxHeight={520} padded={false} />
      </Box>
    </Stack>
  );
}

function WorkspaceTriggerPanel({ workspace, question, setQuestion, send }: {
  workspace: WorkspaceDebugSnapshot | null;
  question: string;
  setQuestion(value: string): void;
  send(command: WorkspaceDebugCommand): void;
}) {
  return (
    <Accordion>
      <AccordionSummary expandIcon={<AppIcon icon={ChevronRight} size={18} />}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AppIcon icon={Wrench} size={18} />
          <Box>
            <Typography variant="subtitle1">实时触发 Workspace 测试</Typography>
            <Typography variant="body2" color="text.secondary">辅助生成新 Trace；执行追踪本身不依赖阅读页连接。</Typography>
          </Box>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Stack spacing={1.5}>
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
                minRows={4}
                label="与阅读页同步的问题草稿"
                value={question}
                slotProps={{ htmlInput: { maxLength: 4000 } }}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  send({ type: "set_question", question: event.target.value });
                }}
              />
              <Button
                disabled={workspace === null || workspace.status === "asking" || question.trim().length === 0}
                startIcon={<AppIcon icon={TerminalSquare} size={16} />}
                onClick={() => send({ type: "submit" })}
              >
                {workspace?.status === "asking" ? "正式调用中…" : "通过 Workspace 发送"}
              </Button>
              {workspace === null && <StatusNotice tone="warning">请先打开阅读页，才能实时触发 Workspace 调用。</StatusNotice>}
              {workspace?.error !== null && workspace?.error !== undefined && <StatusNotice tone="danger">{workspace.error}</StatusNotice>}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>当前引用与会话镜像</Typography>
            <JsonBlock value={{ references: workspace?.pendingReferences ?? [], session: workspace?.session ?? null }} maxHeight={430} padded={false} />
          </Grid>
        </Grid>
      </AccordionDetails>
    </Accordion>
  );
}

function EmptyTraceState() {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", justifyContent: "center", textAlign: "center", flex: 1, p: 4 }}>
      <AppIcon icon={Bot} size={36} />
      <Typography variant="h6">还没有可追踪的执行任务</Typography>
      <Typography color="text.secondary">在产品中触发翻译、Workspace、Recall 或每日阅读后，这里会按任务展示完整执行路径。</Typography>
    </Stack>
  );
}

function KeyValueList({ values }: { values: Record<string, string | number | null> }) {
  return (
    <Stack spacing={0.75}>
      {Object.entries(values).map(([label, value]) => (
        <Stack key={label} direction="row" spacing={2} sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="body2" sx={{ textAlign: "right", wordBreak: "break-all" }}>{value ?? "-"}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function StatusChip({ status, size = "medium" }: { status: ExecutionStatus | AgentDebugTrace["status"]; size?: "small" | "medium" }) {
  const normalized: ExecutionStatus = status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : status === "warning" ? "warning" : "running";
  return <Chip size={size} color={statusChipColor(normalized)} label={executionStatusLabel(normalized)} />;
}

function StatusDot({ status }: { status: ExecutionStatus }) {
  return <Box aria-label={executionStatusLabel(status)} title={executionStatusLabel(status)} sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: statusForeground(status), flexShrink: 0 }} />;
}

function JsonBlock({ value, maxHeight, padded = true }: { value: unknown; maxHeight: number; padded?: boolean }) {
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <Box sx={padded ? { p: 2 } : undefined}>
      <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight, overflow: "auto", bgcolor: "var(--reader-code)", borderRadius: 1, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>
        {content ?? "null"}
      </Box>
    </Box>
  );
}

function choosePreferredStepId(steps: ExecutionStep[], traces: AgentDebugTraceSummary[]): string | null {
  const failedStep = steps.find((step) => step.status === "failed");
  if (failedStep !== undefined) return failedStep.id;
  const traceId = preferredTraceId(traces);
  if (traceId !== null) return steps.find((step) => step.traceId === traceId)?.id ?? null;
  return steps.find((step) => step.status === "failed")?.id
    ?? steps.find((step) => step.status === "warning")?.id
    ?? steps.at(-1)?.id
    ?? null;
}

function EvidenceSection({ title, value }: { title: string; value: unknown }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <JsonBlock value={value} maxHeight={350} padded={false} />
    </Box>
  );
}

function diagnoseOperation(item: ExecutionListItem, traces: AgentDebugTraceSummary[]): ExecutionDiagnosis {
  const failed = traces.find((trace) => trace.status === "failed");
  const running = traces.find((trace) => trace.status === "running");
  if (failed !== undefined) {
    return {
      tone: "danger",
      title: "该任务包含失败的 Agent 调用",
      summary: failed.errorMessage ?? "至少一次 Invocation 执行失败；其他成功调用不会覆盖这条失败证据。",
      focus: failed.taskType ?? failed.traceId,
      suggestions: ["选择红色 Agent 步骤，检查调用内阶段日志、异常和实际请求。"],
    };
  }
  return {
    tone: executionStatusTone(item.status),
    title: running === undefined ? "该任务的全部 Agent 调用均已完成" : "该任务仍有 Agent 调用在执行",
    summary: running === undefined
      ? "执行路径保留每次 Invocation；内容质量请通过对应输入、Prompt 与输出进行检查。"
      : "等待当前调用写入响应与校验结果。",
    focus: running?.taskType ?? traces.at(-1)?.taskType ?? "等待阶段记录",
    suggestions: ["任务级结论与右侧单步结论相互独立；请根据执行路径选择需要检查的调用。"],
  };
}

function summarizeExecutions(items: ExecutionListItem[]) {
  return {
    total: items.length,
    succeeded: items.filter((item) => item.status === "succeeded").length,
    problematic: items.filter((item) => item.status === "failed" || item.status === "warning").length,
    running: items.filter((item) => item.status === "running").length,
  };
}

function statusChipColor(status: ExecutionStatus): "default" | "success" | "warning" | "error" | "info" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  if (status === "warning") return "warning";
  return "info";
}

function statusForeground(status: ExecutionStatus): string {
  if (status === "succeeded") return "success.main";
  if (status === "failed") return "error.main";
  if (status === "warning") return "warning.main";
  return "info.main";
}

function statusBackground(status: ExecutionStatus): string {
  if (status === "succeeded") return "success.light";
  if (status === "failed") return "error.light";
  if (status === "warning") return "warning.light";
  return "info.light";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(createdAt: string, completedAt: string | null): string {
  if (completedAt === null) return "仍在执行";
  const duration = Math.max(0, new Date(completedAt).getTime() - new Date(createdAt).getTime());
  if (duration < 1_000) return `${duration} ms`;
  return `${(duration / 1_000).toFixed(1)} s`;
}

function mergeHistory<T>(first: T[], second: T[], id: (item: T) => string): T[] {
  const values = new Map<string, T>();
  for (const item of [...first, ...second]) {
    if (!values.has(id(item))) values.set(id(item), item);
  }
  return [...values.values()];
}
