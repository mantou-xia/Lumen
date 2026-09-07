# Lumen Data Layer 架构

创建时间：2026-09-06
最后更新时间：2026-09-06
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
- WorkspaceSession、WorkspaceTurn 和 Reference；
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
└── workspace_answers

Runtime
├── operations
└── invocations

Settings
├── application_settings
├── provider_configurations
├── model_policies
└── secret_references
```

Runtime 数据统一 Operation 生命周期，但 TranslationResult、RecallEvaluation、WorkspaceAnswer 和 LearningContext 仍属于各自领域。

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

搜索索引属于可重建 Projection，可覆盖 Expression、Variant、用户笔记、LearningContext 原文和必要 Translation 字段。是否提供全文文档搜索由 Reader 实际需求决定，不提前生成 Embedding。

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

