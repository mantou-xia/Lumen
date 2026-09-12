# Lumen 架构索引

最后更新时间：2026-09-12

`docs/architecture/` 是 Lumen 唯一公开、正式且必须提交 Git 的文档目录。它记录已确认并作为当前实现依据的产品方案、架构决策、数据关系和重要迭代变化。

开发任务开始时，先读取本文件，再读取与任务直接相关且状态为“已确认”的架构文档，以及它们通过相对链接明确引用的文档。

## 当前生效架构

Lumen 一期的当前架构基线由以下已确认文档共同组成：

1. [`0001-2026-09-06-product-and-system-architecture.md`](0001-2026-09-06-product-and-system-architecture.md)：产品边界、部署形态、顶层模块、逻辑分层和跨层依赖。
2. [`0002-2026-09-06-content-document-architecture.md`](0002-2026-09-06-content-document-architecture.md)：Format Module、三种内容投影、文档版本和稳定 Selection。
3. [`0003-2026-09-06-reading-interaction-architecture.md`](0003-2026-09-06-reading-interaction-architecture.md)：Reader Shell、Renderer、交互状态、选中即翻译、Workspace 和 Recall。
4. [`0004-2026-09-06-application-layer-architecture.md`](0004-2026-09-06-application-layer-architecture.md)：Use Case 编排、短事务、Workflow 状态和跨模块协调。
5. [`0005-2026-09-06-agent-runtime-architecture.md`](0005-2026-09-06-agent-runtime-architecture.md)：Controlled Task Runtime、Context Policy、Operation、Invocation 和受控多轮 Workspace。
6. [`0006-2026-09-06-learning-engine-architecture.md`](0006-2026-09-06-learning-engine-architecture.md)：Expression、LearningContext、表达变体、阅读中 Recall 和学习边界。
7. [`0007-2026-09-06-data-layer-architecture.md`](0007-2026-09-06-data-layer-architecture.md)：SQLite、Managed Filesystem、资源生命周期、Schema、迁移和备份。
8. [`0008-2026-09-06-implementation-and-module-architecture.md`](0008-2026-09-06-implementation-and-module-architecture.md)：TypeScript 技术栈、模块化单体、前端状态、Electron、安全与通信协议。
9. [`0009-2026-09-09-collaborative-development-handbook.md`](0009-2026-09-09-collaborative-development-handbook.md)：共同开发流程、Git 命名、模块边界、UI 组件复用、验证和文档同步规范。
10. [`0010-2026-09-10-book-composition-and-reading.md`](0010-2026-09-10-book-composition-and-reading.md)：单一 Document 与 Book 并存、BookPage 编排、Reader Page 切换和聚合阅读进度。
11. [`0011-2026-09-10-contextual-ai-workspace.md`](0011-2026-09-10-contextual-ai-workspace.md)：旧版格式无关原文引用、当前文档知识上下文、独立问答和多 Session 事实（已由 `0014` 替代）。
12. [`0012-2026-09-11-ai-workspace-validation-hold.md`](0012-2026-09-11-ai-workspace-validation-hold.md)：旧版 Workspace 场景验证与暂停背景（已由 `0014` 替代）。
13. [`0013-2026-09-12-daily-reading-automation.md`](0013-2026-09-12-daily-reading-automation.md)：自然语言阅读目标、受控来源池、忠实 Markdown 转换、每日调度与启动补偿、来源图片规则和自动 Page 的 NEW 状态。
14. [`0014-2026-09-12-anchored-ai-reading-assistance.md`](0014-2026-09-12-anchored-ai-reading-assistance.md)：统一英文阅读与技术学习的 AI 能力底层、常驻悬浮球 Workspace、原文锚定 Conversation、解释型请求与 AI 注脚，以及 Agent Loop 边界。

## 任务加载规则

所有开发任务先读取本文和 `0009` 共同开发手册；非局部开发再读取 `0001` 总体架构，并按任务范围加载：

- 文档导入、格式解析、Selection 或位置映射：读取 `0002`、`0004`、`0007`，涉及前端 Renderer 时再读取 `0003` 和 `0008`；
- Reader、Translation Lens、进度或 Recall 交互：读取 `0003`、`0004`、`0008`，并按领域读取 `0002`、`0005` 或 `0006`；
- Workspace、原文引用、文档知识上下文、Conversation、回答来源、外部知识或 Web Search：必须读取 `0014`，涉及旧数据兼容时再读取 `0011` 和 `0012`，并同时读取 `0002`、`0003`、`0004`、`0005`、`0007`、`0008`；
- Book 创建、Page 编排、Book Reader 或聚合进度：读取 `0010`，并同时读取 `0002`、`0003`、`0004`、`0007`、`0008`；
- 每日阅读自动化、受控来源、网页正文转换、自动 Page、启动补偿或 NEW 状态：读取 `0013`，并同时读取 `0002`、`0004`、`0005`、`0007`、`0008`、`0010`；
- Agent Task、Provider、Prompt、Context 或 Operation：读取 `0004`、`0005`、`0007`、`0008`；
- Expression、LearningContext、Learning Library 或 Recall 规则：读取 `0003`、`0004`、`0006`、`0007`；
- SQLite、文件资源、迁移、备份或删除生命周期：读取 `0004`、`0007`、`0008`；
- 工程初始化、Monorepo、Electron、API 或前端状态：读取 `0001`、`0004`、`0008`，再加载涉及的领域文档。

只加载与任务直接相关的文档及其显式关联文档，不默认读取全部架构历史。

## 架构决策

新增正式架构或架构决策时，在本目录使用以下文件名：

```text
NNNN-YYYY-MM-DD-topic.md
```

- `NNNN` 从 `0001` 起单调递增，不复用、不重排。
- `YYYY-MM-DD` 为首次创建日期。
- `topic` 使用小写英文和连字符。
- 编号文档必须包含标题、创建时间、最后更新时间和状态；状态使用“草案”“已确认”或“已废弃”。
- 生效结论只在一份架构文档中作为主要事实维护；被替代时在新旧文档中建立相对链接。

## 历史决策

- [`0011-2026-09-10-contextual-ai-workspace.md`](0011-2026-09-10-contextual-ai-workspace.md)：已由 `0014` 替代，保留旧 Workspace Contract 和持久化事实作为兼容参考。
- [`0012-2026-09-11-ai-workspace-validation-hold.md`](0012-2026-09-11-ai-workspace-validation-hold.md)：已由 `0014` 替代，保留旧 Workspace 场景验证和暂停背景。

## 本地工作资产

计划、调研、报告和实验记录属于个人开发上下文，存放于被 Git 忽略的 `docs-local/`。它们可以为本机工作提供证据，但公开架构必须独立、完整，不能链接或依赖这些文件。
