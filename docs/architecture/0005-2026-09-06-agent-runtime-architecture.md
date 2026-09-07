# Lumen Agent Runtime 架构

创建时间：2026-09-06
最后更新时间：2026-09-06
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
workspace.answer.v1
recall.evaluation.v1
```

### Selection Translation

输入包含稳定 Selection、解析后的上下文、学习档案快照和输出语言。输出包含语境翻译、当前含义、表达类型、简短解释和不确定性。结果必须通过 Schema 校验后才能成为正式 TranslationResult。

### Workspace Answer

输入包含用户问题、显式 References、受控会话上下文和 Context Bundle。输出允许自然语言或受控富文本，但来源必须使用 Lumen 提供的 Reference ID，模型不能凭空创造文档位置。

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

它不能突破显式 Reference 与 Context Policy 去搜索整个本地知识库。

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

## 受控多轮 Workspace

```text
WorkspaceSession
└── WorkspaceTurn[]
    ├── UserQuestion
    ├── ExplicitReferences[]
    ├── ContextPolicy
    ├── ContextSnapshot
    ├── Answer
    └── Operation
```

每个 Turn 都重新解析本回合 References，并在预算内选择必要历史：

1. 始终保留当前用户问题；
2. 始终保留本回合显式引用；
3. 保留最近的相关 Turn；
4. 保留被用户明确引用的旧 Turn；
5. 优先删除最旧且未被引用的历史；
6. 上下文被截断时向交互层提供明确标识。

一期不把整个 Session 的全部历史无条件发送给模型，也不引入 AI 自动会话摘要。真正出现长会话需求后再设计摘要 Invocation 和版本边界。

## 流式输出

- Workspace Answer 可以向 UI 发送临时流式 Delta；
- Delta 不是正式业务事实，不逐 Token 永久保存；
- 完整响应结束后必须执行最终校验；
- 只有成功结果才能持久化为 WorkspaceAnswer；
- 流中断时 Operation 进入失败或中断状态，半截回答不能成为正式答案；
- Translation 和 Recall Evaluation 一期不流式展示。

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

