# Lumen Data Layer 架构

创建时间：2026-09-06
最后更新时间：2026-09-11
状态：已确认

## 目的

本文定义 Lumen 一期的数据所有权、SQLite 与 Managed Filesystem 分工、文档资源生命周期、Schema 原则、版本与迁移以及备份一致性边界。

## 核心定位

> SQLite 管理关系、事务、查询与业务状态，Managed Filesystem 管理原始内容和大型资源，Local Service 是唯一数据所有者和访问入口。

```text
Web UI ───────┐
              ├── Local Service ── SQLite + Managed Filesystem
Electron UI ──┘
```

Web 和 Electron 都不能直接读写业务数据库或受管文件。Electron 获取的本地文件也必须交给 Local Service 的导入流程。

## 数据分类

```text
Lumen Data
├── 原始内容
│   └── PDF / EPUB / DOCX / Markdown / TXT / Image
├── 文档投影
│   ├── Render Projection
│   ├── Semantic Projection
│   └── Source Mapping
├── 业务数据
│   ├── Reading Progress
│   ├── Translation
│   ├── Expression / LearningContext
│   ├── Recall
│   └── Annotation
└── Runtime Data
    ├── Operation / Invocation
    ├── Context Snapshot
    └── Provider / Error / Telemetry
```

数据性质还必须区分：

- Fact：用户真实执行的行为或已经确认的业务事实；
- Snapshot：结果生成时依赖的不可变上下文、任务版本和模型元数据；
- Projection：为查询、渲染或性能生成且可以重建的数据。

Projection 不能成为唯一事实来源。

## SQLite 与 Managed Filesystem 分工

### SQLite

SQLite 保存所有需要关系、事务、查询、约束和索引的数据，包括：

- Document、DocumentRevision 和资源逻辑索引；
- Semantic Block 和 Source Mapping 可查询索引；
- Selection、Semantic Range 和 Reading Progress；
- Translation、Expression、LearningContext、Recall 和 Annotation；
- Conversation、Turn、AiFootnote 和 Reference；旧 WorkspaceSession / WorkspaceTurn 仅作为兼容数据保留；
- Operation、Invocation、配置和模型策略。

SQLite 符合单机、本地、个人使用的产品边界，不要求用户额外安装数据库服务。

### Managed Filesystem

Managed Filesystem 保存：

- 原始文档；
- 图片、字体和其他二进制资源；
- EPUB / DOCX 解包资源；
- 大型 Render Projection；
- 大型 Source Mapping 或语义投影文件；
- 解析中间产物；
- 可重新生成的缓存。

SQLite 中只保存 `resourceId`、`storageKey`、内容哈希和必要索引。`storageKey` 是 Local Service 管理的相对标识，API 不暴露绝对路径。

完整 Source Mapping 若体积很大可以存为受管投影文件，但常用定位字段和查询索引仍保存在 SQLite。

## 数据目录

概念布局：

```text
lumen-data/
├── lumen.db
├── documents/
│   └── {documentId}/
│       ├── source/
│       ├── resources/
│       └── projections/
├── cache/
├── temp/
├── logs/
└── config/
```

真实目录名和文件名由 Local Service 管理，用户原始文件名只用于展示或导出，不能参与业务身份或路径拼接。

## 导入即纳管

正式文档必须复制进入 Managed Filesystem，Lumen 不长期依赖用户原文件的绝对路径。

```text
外部文件
   ↓ 流式接收
staging
   ↓ 计算 Hash、Inspect、Parse、Validate
受管 Source Resource
   ↓
DocumentRevision
```

原因：外部文件可能被移动、重命名、删除或静默修改，无法保证 Revision、Source Mapping 和历史学习位置的稳定性。

Markdown 中的远程图片和文件夹内相对图片都遵循“导入即纳管”。远程图片由 Local Service 受控下载；相对图片只从本次文件夹上传集合中、按 Markdown 所在目录解析。成功图片按 Revision 写入 Managed Filesystem，并在 SQLite 保存原始引用、替代文本、媒体类型、哈希和状态；失败项保存为 `missing` 逻辑资源，等待用户后续上传补齐。Reader 始终通过 Resource API 读取已提交图片，不依赖原始远程 URL 或用户文件夹位置。

SVG 在进入 Managed Filesystem 前必须完成服务端净化，保存、计算哈希和响应给 Reader 的都是重新序列化后的安全内容，而不是用户提供的原始 XML。手动补齐缺失图片时遵循同一处理流程，不能形成绕过导入安全边界的第二入口。

### DocumentResource

```text
DocumentResource
├── resourceId
├── documentId
├── revisionId
├── role
├── mediaType
├── originalFilename
├── storageKey
├── contentHash
├── byteSize
├── state
├── durability
├── metadata
└── createdAt
```

`role` 可以是 source、embedded_resource、render_projection、semantic_projection、source_mapping、thumbnail、cache 或 intermediate。

`resourceId` 是业务身份，`contentHash` 用于完整性校验、重复提示和缓存键，两者不能混为一谈。

一期记录内容哈希，但不实现跨文档物理去重、引用计数和 Blob 回收。每个 Revision 管理自己的 Source Resource，保持所有权简单。

## DocumentRevision 生命周期

```text
Document
└── DocumentRevision[]
    ├── Source
    ├── Render Projection
    ├── Semantic Projection
    └── Source Mapping
```

Selection、Translation、LearningContext、Recall、Annotation 和 Workspace Reference 都引用具体 Revision。

- 新导入或语义重新解析创建新 Revision；
- 新 Revision 完成前，旧 Revision 继续可读；
- 验证和资源提交完成后再原子切换 `activeRevisionId`；
- 旧 Revision 的稳定投影被历史业务数据引用时不能作为普通缓存删除；
- 位置迁移必须是显式过程，不能假设旧 `blockId + offset` 对新 Revision 天然有效。

## 可恢复资源提交

SQLite 和文件系统没有共同原子事务，导入采用有限的 staging / committed 恢复协议：

```text
1. 写入 staging 并计算 Hash
2. 生成并验证全部 Artifact
3. SQLite 短事务登记 committing 状态
4. 将资源提升到 committed 区域
5. SQLite 短事务激活 Revision
6. 清理 staging
```

Local Service 启动时检查：

- staging 无数据库记录：清理过期临时文件；
- committing 且文件完整：完成激活；
- committing 且文件缺失：标记中断并清理不完整数据；
- ready Revision 资源缺失或 Hash 不一致：标记 unavailable，不能伪装为可阅读。

未完成导入由 ImportOperation 展示状态，不提前创建普通 Library Document。

## 归档与永久删除

默认删除行为是归档：

```text
Document.status = archived
Expression.status = archived
LearningContext.status = archived
```

归档保留来源、Revision、Translation、LearningContext、Annotation、RecallAttempt 和 Workspace 引用。

永久删除必须由用户明确触发，并显式处理全部引用关系。存在学习数据的文档不能被静默物理删除。可以选择一并删除依赖数据，或保留历史 Snapshot 但失去原文跳转能力；具体产品交互由后续实施设计确定。

可重建缓存可以清理，Durable Resource 和历史 Revision 依赖的稳定投影不能作为普通缓存删除。

## Lexical Profile 缓存

稳定词汇资料属于 Local Service 管理的持久缓存，但必须保留来源版本和许可追踪信息。SQLite 分别保存：

- `lexical_entries`：来源、语言、规范化 lemma、Wiktionary revision、来源 URL、署名、许可标识和原始 wikitext 快照；
- `lexical_profiles`：解析器版本与规范化事实快照；
- `lexical_localizations`：受控本地化 Operation、来源 revision、本地化器版本与中文快照。

同一来源、语言和规范化 lemma 只保留一个当前 Entry 缓存。来源 revision 更新时可替换当前 Profile 并废弃旧本地化，但不能通过级联或业务更新改写 Translation、LearningContext 等历史事实。

## Schema 建模原则

```text
需要关联、筛选、排序、约束的数据
→ 明确关系表与字段

不可变、任务专属、可能版本演进的数据
→ 版本化 Snapshot JSON

大型内容和二进制数据
→ Managed Filesystem
```

数据库不能退化成少数通用 JSON 表，也不必把所有模型输出字段拆成高度耦合的关系结构。

### Snapshot

所有 Snapshot 使用版本化 Envelope：

```text
SnapshotEnvelope
├── schemaVersion
├── type
└── payload
```

适合 Snapshot 的内容包括 Context、Translation、LearningProfile、Task Input / Output、Provider Metadata 和格式专属 Source Location。

### 核心表组

```text
Content
├── documents
├── document_revisions
├── document_resources
├── markdown_images
├── books
├── book_pages
├── book_reading_states
├── book_page_progress
├── semantic_blocks
├── source_mapping_indexes
├── document_outlines
└── reading_progress

Translation
├── translations
└── translation_results

Learning
├── expressions
├── expression_variants
├── learning_contexts
├── recall_occurrences
├── recall_attempts
└── annotations

Workspace
├── workspace_sessions
├── workspace_turns
├── workspace_turn_references
├── workspace_answers
└── semantic_block_fts（可重建 Projection）

Runtime
├── operations
├── invocations
├── operation_events
├── runtime_cache_hits
└── agent_debug_traces（仅开发模式写入）

Settings
├── application_settings
├── provider_configurations
├── model_policies
└── secret_references
```

当前规模下，外部资料网络线路以 `application_metadata` 中的单一版本化 JSON 配置持久化，字段包含模式、代理协议、主机和端口。它属于 Local Service 权威设置，不属于浏览器本地偏好；后续 Settings 扩展到多类可查询配置时，再迁移到独立 `application_settings` 表，不提前为单条配置增加通用表结构。

Runtime 数据统一 Operation 生命周期，但 TranslationResult、RecallEvaluation、WorkspaceAnswer 和 LearningContext 仍属于各自领域。

`operation_events` 以 `(operation_id, sequence)` 保存单调状态事件，供 HTTP 增量查询与 SSE 回放；`invocations` 以 `(operation_id, attempt_number)` 保证同一 Operation 内的实际 Provider 调用顺序，并记录 Token、Latency、Finish Reason、Provider、Model 与标准错误。`runtime_cache_hits` 只记录领域正式结果被复用的事实，不复制模型输出。

`markdown_images` 保存 Markdown Revision 内图片的稳定资源身份、原始 URL、替代文本、受管存储元数据和 `staging / committed / missing` 状态。图片二进制仍位于 Managed Filesystem；手动替换 `missing` 图片时保持原资源 ID，并同步更新该 Revision 的 Render Projection。

`agent_debug_traces` 是开发者调试资产，不是产品业务事实。每条记录从正式 Provider Invocation 开始即以稳定 Trace ID 落库，并保存 `operation_id`、`invocation_id`、Task 版本以及版本化请求、响应或错误快照；它可以关联正式 Operation/Invocation 还原调用链，但不成为 WorkspaceTurn 或用户学习数据的领域外键。Local Service 重启后仍可查询，该表只通过开发模式 API 访问。

schema 18 创建 `agent_debug_traces`；schema 19 创建 `markdown_images`；schema 20 增加正式 Runtime 的 `operation_id`、`invocation_id`、`task_type`、`task_version` 关联列和查询索引。调试快照只保存脱敏后的请求，真实 Authorization Header 不入库。

`annotations` 保存不可变的 Revision、Semantic Range、选中文本和 Source Range 快照，并保存可变的用户笔记、来源引用与 active/archived 状态。可见范围查询使用 Revision 与 Semantic Block 顺序索引；归档不删除 Annotation，也不级联删除其引用的 Translation 或 LearningContext。

schema 14 增加 `workspace_sessions`、`workspace_turns`、`workspace_turn_references` 和 `workspace_answers`。后续 Workspace 增强迁移移除 `document_id + revision_id` 的唯一约束，使一个 Document Revision 可以拥有多个独立 Session；每个 Turn 保存问题、显式与检索 Reference 快照，以及通过校验的 Answer outcome、context mode、context stats 和 citation snapshot。Answer 继续以唯一 `operation_id` 关联 Runtime 生命周期。

### Semantic Range

稳定位置的关键坐标使用明确字段：

```text
revision_id
start_block_id
start_offset
end_block_id
end_offset
semantic_range_fingerprint
```

必要时附加 `source_ranges_snapshot` 和 `selected_text_snapshot`。这些字段可以嵌入具体业务表并复用统一 Value Object，不强制一期建立通用 `semantic_ranges` 表。

## ID、时间与顺序

- API、Snapshot、文件索引和跨模块引用使用应用生成的稳定字符串领域 ID；
- SQLite 可以保留内部整数键，但不能将其暴露为跨层身份；
- Block 使用明确的整数顺序字段，不依赖 ID 排序；
- 一期 Revision 不可变，不为协同编辑设计复杂可插入排序键；
- 持久化时间统一使用 UTC，展示时转换为本地时区；
- 业务发生时间、写入时间和 Provider latency 分开记录。

## 外键与幂等

SQLite 必须显式启用外键约束。

Document 和 Expression 等核心实体不使用大范围级联删除。只有完全依附且没有独立业务意义的数据，例如 Invocation 对所属 Operation，可以在明确永久删除时级联。

幂等规则同时由领域逻辑和数据库唯一约束保护，例如：

```text
learning_contexts:
UNIQUE(expression_id, revision_id, semantic_range_fingerprint)

expression_variants:
UNIQUE(expression_id, normalized_pattern)

reading_progress:
UNIQUE(document_id)

book_pages:
UNIQUE(book_id, document_id)
UNIQUE(book_id, page_order)

book_reading_states:
UNIQUE(book_id)

book_page_progress:
UNIQUE(book_page_id)

invocations:
UNIQUE(operation_id, attempt_number)
```

`normalizedForm` 只建立查询索引，不做全局唯一，以支持同形异义、人工拆分和归一化修正。

## SQLite 执行策略

- Local Service 集中管理数据库连接和事务；
- 启用适合并发读写的日志模式；
- 写事务保持短小；
- 解析、文件流和 Provider 调用期间不持有事务；
- Semantic Blocks 和映射索引批量写入；
- 大型投影不作为 SQLite BLOB 保存；
- 数据库忙只执行有限重试；
- Worker 通过 Repository / Transaction Port 写入，不能各自绕过边界打开任意连接。

## 搜索

一期不引入向量数据库。结构化筛选使用普通索引，全文搜索使用 SQLite 自带全文索引能力或简单文本查询。

搜索索引属于可重建 Projection，可覆盖 Expression、Variant、用户笔记、LearningContext 原文和必要 Translation 字段。Workspace 为当前 Document Revision 建立格式无关的 Semantic Block FTS5 Projection，用于全文超过上下文预算时选择回答依据；它不提供跨文档搜索，也不提前生成 Embedding。

一期 Learning Library 使用 SQLite 条件查询与有界游标分页，不在进程内读取全量 Expression 和 LearningContext。列表摘要只投影卡片所需字段；表达详情按单个 `expressionId` 读取稳定词汇缓存与历史语境。

Agent Runtime 的本地调试 Trace 和每日阅读 Workflow 事件是可追溯历史，随正式调用常驻写入 SQLite，不依赖调试页面在线。开发查询使用按创建时间和稳定 ID 排序的有界游标分页，避免固定条数截断历史，也避免一次性把全部快照读入内存。

schema 11 为 `learning_contexts` 增加独立用户笔记和更新时间，并建立 `expression_status_history`。Expression 与 LearningContext 笔记是用户事实，不写入 Translation Snapshot；状态历史记录每次真实状态迁移。归档 LearningContext 只更新状态，外键仍以 `ON DELETE RESTRICT` 保留 Translation 与 Operation。

## 版本与迁移

以下三个版本维度必须分开：

```text
Database Schema Version
Snapshot Schema Version
Document Projection Version
```

数据库使用单向编号迁移：

```text
0001_initial
0002_add_workspace
0003_add_expression_variants
```

规则：

- 应用启动时检查数据库版本；
- 迁移前确认数据目录可写；
- 迁移在明确事务中执行；
- 迁移失败时停止正常启动；
- 已发布迁移文件不可重写；
- Snapshot 升级和 Document Projection 重建不混入数据库版本概念。

## 备份一致性

完整备份不能只复制 `lumen.db`。备份单位为：

```text
Backup
├── SQLite 一致性快照
├── Durable Managed Resources
├── 配置
├── Schema / Projection 元数据
└── Manifest + Hash
```

备份由 Local Service 建立一致性边界、生成 SQLite 快照、复制 Durable Resources 并最终写入 Manifest。缓存和可重建投影可以排除，但恢复后必须能够重建。

一期不要求自动定时或云备份，但数据布局必须支持用户显式导出和恢复完整备份。

## 一期明确不做

- PostgreSQL / MySQL 等独立数据库；
- 云对象存储；
- 多用户和租户字段；
- 分布式缓存；
- 向量数据库；
- CQRS 和完整 Event Sourcing；
- 为未来同步预设复杂冲突模型；
- 跨文档物理 Blob 去重；
- 大范围静默级联物理删除。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
- [上下文 AI Workspace 架构](0011-2026-09-10-contextual-ai-workspace.md)
