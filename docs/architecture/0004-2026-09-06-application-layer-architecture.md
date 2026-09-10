# Lumen Application Layer 架构

创建时间：2026-09-06
最后更新时间：2026-09-10
状态：已确认

## 目的

本文定义 Lumen Application Layer 的职责、Use Case 分类、事务边界、长任务执行模型和跨模块协调规则。

## 核心定位

> Application Layer 是独立的 Use Case 编排层，负责把用户意图转化为确定的业务流程与事务，不把编排逻辑散落到 UI、HTTP Controller、领域模块或 Repository 中。

```text
Interaction Layer
        ↓ Intent
Application Layer
        ↓
Content / Learning / Workspace / Agent Runtime Ports
        ↓
Infrastructure
```

Application Layer 负责：

- 接收并验证 Interaction Layer 表达的 Intent；
- 解析和校验领域引用；
- 编排一次完整 Use Case；
- 确定短事务边界；
- 创建和推进持久化 Workflow 状态；
- 协调 Content、Learning、Workspace 和 Agent Runtime；
- 决定业务数据何时以及如何改变；
- 返回面向交互层的 Application Result。

Application Layer 不负责具体 UI、文档格式解析、表达匹配算法、Prompt 编译、Provider 调用或 SQLite 实现。

## Use Case 分类

一期按职责分为 Command、Query 和 Workflow，但这只是代码组织方式，不引入 CQRS 框架或独立部署单元。

### Command Use Case

Command 完成短暂、确定性的业务状态变更，例如：

- ArchiveDocument；
- UpdateDocumentMetadata；
- UpdateReadingProgress；
- CreateBook / ReorderBookPages / UpdateBookReadingProgress；
- SaveLearningItem；
- CreateAnnotation / UpdateAnnotation；
- UpdateExpressionNote；
- MarkExpressionFamiliar / ArchiveExpression；
- UpdateReadingPreferences；
- ConfigureModelProvider。

### Query Use Case

Query 读取权威数据并组织面向界面的结果，例如：

- ListDocuments / GetRecentDocuments；
- OpenDocument / GetDocumentOutline；
- GetReadingProjection / GetReadingProgress；
- ListBooks / GetBook / OpenBook；
- GetRecallMatches；
- SearchExpressions / GetExpressionDetails；
- ListWorkspaceSessions / GetWorkspaceSession；
- GetApplicationSettings / GetProviderStatus。

Query 可以组合多个读取模型，但不能顺便改变业务状态。

### Workflow Use Case

Workflow 编排文档处理、模型调用或其他跨多个阶段的长任务，例如：

- ImportDocument；
- ReparseDocument；
- TranslateSelection；
- AskWorkspaceQuestion；
- CreateWorkspaceSession；
- EvaluateRecall。

## 事务模型

核心原则：

> 短事务 + 持久化 Workflow 状态 + 外部执行置于事务外。

文档解析、文件流和 Model Provider 调用不能在 SQLite 写事务中执行。数据库事务只包围短暂、确定性的状态读取与写入。

### 普通业务写入

例如保存学习项：

```text
开始事务
├── 校验 TranslationOperation 已完成
├── 校验 Selection 与 DocumentRevision
├── 查找或创建 Expression
├── 创建或复用 LearningContext
├── 保存不可变 Snapshot
└── 提交事务
```

任一步失败则整体回滚，不能留下只有 Expression 而没有 LearningContext 的半完成状态。

### Agent Workflow

```text
事务 A
├── 校验领域引用
├── 创建业务对象与 Operation(requested)
└── 提交
        ↓
事务外
├── 构建 Context Bundle
├── 调用 Agent Runtime
└── 校验输出
        ↓
事务 B
├── 保存正式业务结果
├── Operation → completed
└── 提交
```

失败、取消或中断时，使用新的短事务保存标准化错误和终态。

### 文档导入 Workflow

```text
流式接收来源到 staging
        ↓
创建并推进 ImportOperation
        ↓
Adapter 检测、解析和生成投影
        ↓
校验 Artifact 与 Source Mapping
        ↓
短事务登记待提交资源和 Revision
        ↓
提升受管文件
        ↓
短事务激活 DocumentRevision
        ↓
Document 对 Library 可见
```

未完成导入由 ImportOperation 表示，不能提前显示为正式可读 Document。

## Workflow 状态

通用生命周期保持有限：

```text
requested
   ↓
running
   ├── completed
   ├── failed
   ├── cancelled
   └── interrupted
```

- `failed` 表示已经获得明确失败结果；
- `cancelled` 表示用户或系统明确请求终止；
- `interrupted` 表示 Local Service 意外退出，任务没有正常结束。

一期不增加等待工具、等待规划或复杂补偿等开放式 Agent 状态。

## 中断与重试

- 文档导入和重新解析可以根据 staging、原始 Source 和状态进行恢复、清理或重建；
- Translation、Workspace Answer 和 Recall Evaluation 中断后不自动重试；
- AI 调用可能已经产生 Token 成本，用户必须明确决定是否重试；
- 同一业务意图内部的技术重试在原 Operation 下增加 Invocation；
- 用户主动“重新生成”创建新 Operation，并通过 `previousOperationId` 关联旧操作。

## Reference Resolver 与 Context Builder

Interaction Layer 只提交引用身份，Application Layer 的 Reference Resolver 负责解析领域事实：

```text
Intent + Reference IDs
        ↓
Reference Resolver
├── 查找 Selection / Block / Translation / Learning Item / Turn
├── 校验 DocumentRevision
├── 校验引用关系和有效性
└── 产生 Resolved References
        ↓
Document Context Builder
├── 预算内读取当前 Revision 全文
└── 超预算时查询当前 Revision Semantic Block FTS
        ↓
Agent Runtime Context Compiler
```

Application Layer 决定引用对应什么业务事实，Agent Runtime 决定模型在 Context Policy 和预算内最终看到什么。

Workspace 每轮允许没有显式 Reference；Application 仍必须为问题构建当前 Document Revision 的可信知识上下文。历史 Turn 不作为隐式会话上下文，只有 `workspace_turn` Reference 才能进入本轮。多 Session、严格文档回答和来源快照规则见 [上下文 AI Workspace 架构](0011-2026-09-10-contextual-ai-workspace.md)。

## 跨模块协调

跨模块 Use Case 和事务由 Application Layer 显式协调，领域模块维护自己的业务不变量。

例如 `SaveLearningItem`：

```text
Application
├── ContentQueryPort 获取可信 Selection
├── TranslationQueryPort 获取完成结果
├── 组织 SaveLearningContextInput
└── LearningService 执行聚合与幂等规则
```

Learning 模块不能自行读取 Content 数据表，Content 模块也不能直接创建 LearningContext。

## 流式输出

流式片段是临时 Interaction Event，不是业务事实：

```text
Provider Stream
    ↓
临时 Workspace Delta
    ↓
完整响应与最终校验
    ↓
持久化 WorkspaceAnswer
```

客户端断开或流式中断不能让数据库留下伪成功结果。Translation 和 Recall Evaluation 一期只在完整结构化结果通过校验后返回。

## 领域事件边界

允许使用有限的进程内事件处理派生副作用，例如索引重建和缓存失效：

- DocumentRevisionActivated；
- DocumentArchived；
- ExpressionStatusChanged。

核心业务流程必须保持显式 Use Case 调用，不能用隐式事件链替代主事务。

## 一期明确不做

- CQRS 框架；
- 通用工作流引擎；
- 消息队列；
- Saga 或分布式事务；
- 依赖事件最终一致性的主业务流程；
- AI Workflow 自动恢复和自动重复扣费。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
- [上下文 AI Workspace 架构](0011-2026-09-10-contextual-ai-workspace.md)
