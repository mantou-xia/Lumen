# Lumen Agent Runtime 架构

创建时间：2026-09-06
最后更新时间：2026-09-08
状态：已确认

## 目的

本文定义 Lumen 一期 AI 能力的执行边界、Task Contract、Context Policy、Workspace 多轮语义、Operation 与 Invocation 关系、Provider 抽象以及未来 Agent 化演进边界。

## 核心定位

> Agent Runtime 是 Lumen 的受控 AI 任务执行层，而不是通用自主 Agent。

一期正式采用：

> Controlled Task Runtime + 受控多轮 Workspace，不实现开放式 Agent Loop。

```text
Agent Runtime
├── Structured Task
│   ├── Selection Translation
│   └── Recall Evaluation
└── Contextual Task
    └── Workspace Answer
```

模型只负责理解、翻译、解释、回答和判断。Context Builder 决定模型能看到什么，Application Layer 决定业务数据如何改变，Runtime 管理 AI Task 的执行方式。

## 一期边界

- 不提供开放式 Agent Loop；
- 不允许模型任意调用 Tool；
- 不注册任意 Tool；
- 不允许模型自行搜索全部本地文档或学习数据；
- 不允许模型直接写入 Learning、Recall、Annotation 或其他业务数据；
- 不引入自主规划机制；
- Workspace 每个用户回合执行一次边界明确的受控模型任务；
- Operation 从一期起允许容纳多个 Invocation。

## 核心执行链

```text
Intent
  ↓
Task Handler
  ↓
Resolved References
  ↓
Context Compiler
  ↓
Prompt / Task Definition
  ↓
Model Provider
  ↓
Output Validation
  ↓
Operation Result
```

Runtime 负责：

- Task 生命周期、取消、有限重试和超时；
- Task Registry 与版本化 Task Definition；
- Context Policy、预算、裁剪与 Context Bundle；
- Prompt Compiler；
- Model Provider 抽象与路由；
- 输出 Schema 和格式校验；
- Structured Task 结果缓存；
- Token、耗时、Provider、失败和缓存命中的可观测性。

## Task Definition

Application Layer 不能直接拼 Prompt。Runtime 注册版本化任务：

```text
TaskDefinition
├── taskType
├── version
├── inputSchema
├── allowedReferenceTypes
├── defaultContextPolicy
├── contextBudget
├── promptCompiler
├── outputSchema
├── modelRequirements
├── cachePolicy
├── retryPolicy
└── timeoutPolicy
```

一期至少包含：

```text
selection.translation.v1
workspace.query-rewrite.v1
workspace.answer.v2
recall.evaluation.v1
```

当前 Runtime 已将 Selection Translation、Recall Evaluation、Lexical Localization 和 Workspace Answer 注册为版本化 Task Definition。Task Definition 统一声明 Prompt 版本、输入输出 Schema、允许的 Reference 类型、Context Policy、预算、模型要求、领域缓存策略、有限重试和超时策略，Application 不再直接维护 Provider Prompt。

### Selection Translation

输入包含稳定 Selection、解析后的上下文、学习档案快照和输出语言。输出包含语境翻译、当前含义、表达类型、简短解释和不确定性。结果必须通过 Schema 校验后才能成为正式 TranslationResult。

### Workspace Answer

`workspace.answer.v2` 输入包含用户问题、可选显式 References，以及由当前 Document Revision 全文或检索结果组成的 Context Bundle。输出包含受控 Markdown、`answered / insufficient_evidence`、上下文模式、来源 ID 和上下文统计；来源只能使用 Context Bundle 中已有的 Reference ID。

历史 Turn 不自动加入模型上下文。只有用户显式提交 `workspace_turn` Reference 时，Reference Resolver 才将该问答快照加入本轮。长文档检索前可以执行 `workspace.query-rewrite.v1` 生成英文检索词；该辅助 Invocation 失败时必须使用确定性回退检索，不能成为主回答的单点故障。

### Recall Evaluation

输入包含 Expression、当前阅读语境、用户理解、选定的历史语境和学习档案快照。输出包含 verdict、feedback、contextualMeaning 和 missingPoints。Application Layer 决定如何保存 RecallAttempt。

## Context Bundle 与 Context Policy

Context Builder 可以按策略受控扩展上下文：

```text
Selection Only
Selection + Surrounding Context
Selection + Paragraph
Selection + Section
Explicit References
Full Document Revision
Retrieved Document Blocks
```

正式输出是结构化 Context Bundle，而不是前端拼好的长字符串：

```text
ContextBundle
├── taskType
├── policy
├── primaryContext
├── references[]
│   ├── referenceId
│   ├── referenceType
│   ├── content
│   ├── provenance
│   └── semanticLocation
├── conversationContext
├── learningProfileSnapshot
├── limits
├── fingerprint
└── compilerVersion
```

Prompt Compiler 再把 Context Bundle 转为 Provider 所需消息格式。

Context Compiler 负责：

- 执行 Context Policy；
- 选择必要 Block、段落、章节和显式引用；
- 去重和确定性排序；
- 控制字符与 Token 预算；
- 保留来源标识；
- 生成可追踪的 Context Snapshot 和 Fingerprint。

它不能突破当前 Document Revision 与 Context Policy 去搜索其他文档、BookPage 或本地知识库。

Context Compiler 在 Provider 调用前生成版本化 Context Bundle，并覆盖 Operation 中的权威 `context_snapshot`；同时写入 `task.compiled` 事件，事件只记录 Task/Policy/Compiler 身份，不复制 Secret。当前结构化任务只接受调用方明确提供的 Selection、Recall Occurrence、LearningContext 或 Lexical Profile，不提供全库搜索入口。

## Operation 与 Invocation

```text
Operation
├── Intent
├── Task Definition Version
├── References
├── Context Policy / Snapshot
├── Status
├── Result / Error
└── Invocation[]
```

`Operation` 表示一次完整业务意图，例如一次选区翻译或 Workspace 用户回合；`Invocation` 表示一次实际 Provider 调用尝试。

一个 Operation 可以因为以下原因产生多个 Invocation：

- Provider 调用失败后的有限技术重试；
- 超时后重新调用；
- 主 Provider 失败后按明确策略切换备用 Provider；
- Schema 校验失败后的有限纠正；
- 未来受控任务内部增加更多执行步骤。

多 Invocation 不改变“一次用户回合对应一个受控任务”的产品语义，也不能演变成自主循环。

状态模型：

```text
OperationStatus
requested / running / completed / failed / cancelled / interrupted

InvocationStatus
pending / running / succeeded / failed / cancelled / interrupted
```

同一 Operation 的 Invocation 使用稳定 attempt 顺序。用户主动重新生成创建新 Operation，并关联 `previousOperationId`。

Runtime 对可重试 Provider 错误和结构校验失败执行有上限的修复重试；每次实际调用都按 Operation 内的 `attemptNumber` 单调递增。用户取消按 `operationId` 中止 Runtime 持有的 AbortController，Application 随后以短事务写入 Invocation 与 Operation 的取消终态，避免“数据库先取消、Provider 后落库”的竞态。

## 独立 Turn 与多 Session Workspace

```text
DocumentRevision
└── WorkspaceSession[]
    └── WorkspaceTurn[]
        ├── UserQuestion
        ├── Optional ExplicitReferences[]
        ├── DocumentContext
        ├── ContextSnapshot
        ├── Answer
        └── Operation
```

每个 Turn 都重新解析本轮显式引用，并重新从当前 Revision 构建全文或检索上下文。Session 负责历史展示和恢复，不意味着模型自动获得之前的 Turn。显式引用始终优先保留；全文超出预算时改用 Semantic Block FTS 和相邻语境。完整规则见 [上下文 AI Workspace 架构](0011-2026-09-10-contextual-ai-workspace.md)。

## 流式输出

- Workspace Answer 可以向 UI 发送临时流式 Delta；
- Delta 不是正式业务事实，不逐 Token 永久保存；
- 完整响应结束后必须执行最终校验；
- 只有成功结果才能持久化为 WorkspaceAnswer；
- 流中断时 Operation 进入失败或中断状态，半截回答不能成为正式答案；
- Translation 和 Recall Evaluation 一期不流式展示。

Operation 状态事件通过 `operationId + sequence` 持久化。SSE 只回放 sequence 之后的事件通知，终态后关闭；浏览器断线重连使用最后 sequence 继续订阅，并始终通过 HTTP Operation Query 恢复完整权威状态。SSE 重复连接不执行业务命令，也不写入业务结果。

## Provider 与 Model Policy

Task 不直接绑定具体厂商：

```text
Task Definition
      ↓ Model Requirements
Model Policy
      ↓
Provider Router
      ↓
Provider Adapter
```

`ProviderConfiguration` 描述 Endpoint、Credential Reference、可用模型和连接选项；`ModelPolicy` 按 Task Type 指定首选模型、Fallback、温度、输出预算和能力要求。

当前 Provider Router 已按 Task Definition 的模型要求选择已配置 Adapter，并保留确定性默认 Adapter；可持久化 Provider Configuration、Model Policy、Secret Reference 由 Settings 阶段接入，不在 Runtime 内读取浏览器配置。

Provider 密钥不能进入 Operation、Invocation、日志或 Context Snapshot。

## Structured Task 缓存

缓存键不能只依赖 selectedText，至少应覆盖：

```text
Task Type
+ Task Definition Version
+ Document Revision
+ Semantic Selection
+ Context Policy
+ Context Fingerprint
+ Learning Profile Snapshot
+ Output Language
+ Model Policy Fingerprint
```

相同文本在不同语境、学习档案和任务版本下不得错误复用。

一期缓存复用领域正式结果，而不建立第二份 Runtime 结果真相：Translation 以 Revision + Semantic Selection Fingerprint 命中原 TranslationResult，Lexical Profile 使用来源 Revision 的持久缓存。每次命中单独写入 `runtime_cache_hits` 并投影到来源 Operation 的 `cacheHitCount`，不会伪造 Invocation 或重复业务结果。

## 可观测性

Runtime 记录：

- Operation 与 Invocation 状态和时间；
- Provider、模型和策略版本；
- 输入输出 Schema 版本；
- Token 使用量；
- Latency 与 Finish Reason；
- 缓存命中；
- 标准化错误和 Trace ID。

可观测性服务于本地调试和结果追踪，不能泄漏密钥、认证头或不必要的完整敏感内容。

## 演进方向

一期的 Operation / Invocation、Task Registry 和 Provider Port 允许未来按真实需求演进：

```text
Controlled Task Runtime
        ↓
Planner
        ↓
Tool Executor
        ↓
Agent Loop
```

Planner、Tool Calling 和 Agent Loop 只有在出现无法由受控 Task 满足的真实复杂任务后才引入，不能作为一期预设复杂度。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [上下文 AI Workspace 架构](0011-2026-09-10-contextual-ai-workspace.md)
