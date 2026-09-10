# Lumen 阅读交互架构

创建时间：2026-09-06
最后更新时间：2026-09-10
状态：已确认

## 目的

本文定义 Reader 的公共交互结构、状态所有权、选中即翻译流程、Contextual AI Workspace、阅读中 Recall 以及 Renderer 与产品交互之间的边界。

## 核心原则

> 阅读区优先、功能按需出现、AI 围绕阅读上下文工作。

Lumen 必须让用户始终停留在阅读上下文中。AI 是阅读过程的延伸，不能把 Reader 改造成 Chat 页面。

## Interaction Layer 结构

```text
Interaction Layer
├── Reader Shell
│   └── 公共阅读 UI、目录、工具栏和状态
├── Format Renderer
│   └── PDF / Markdown / DOCX / EPUB / TXT
├── Reading Interaction Coordinator
│   └── Selection / Viewport / Progress / Navigation / Highlight
├── Context Interaction
│   └── Reference Composer / Contextual AI Workspace
└── Learning Interaction
    └── Translation / Learning Item / Annotation / Recall
```

### Reader Shell

Reader Shell 提供公共产品界面，不直接操作格式专属 DOM、PDF 页面、EPUB iframe 或其他 Renderer 内部对象。

Reader Shell 的完整目录按 Outline `depth` 构造成可展开、收起的树形结构，每一行只承载一个标题导航按钮；左侧轻量圆点导航只投影二级标题，一个圆点对应一个大章节，并根据当前可见语义位置标识活动章节。三级及更深标题只在完整目录中展示，避免轻量导航失去章节层级语义。

### Format Renderer

Format Renderer 负责格式专属呈现，并通过统一 Contract 向 Coordinator 报告选区、可见范围、阅读位置和导航事件。

### Reading Interaction Coordinator

Coordinator 连接 Renderer 与产品交互，统一管理当前阅读会话，决定何时将原生事件转换为 Application Use Case。

## 状态所有权

Reader 状态分成三层，前端整体再区分 Local Service 的 Server State。

### Renderer Internal State

由具体 Renderer 私有拥有，例如已渲染 PDF 页面、EPUB Spine、DOM Selection、页面布局和临时高亮实例。其他层只能通过 Renderer Contract 使用这些状态。

### Reading Session State

由每个 Reader Instance 的 Coordinator 拥有：

```text
ReadingSessionState
├── readerInstanceId
├── readingContext(document / book)
├── bookId / activePageId（Book 模式）
├── documentId
├── revisionId
├── rendererStatus
├── selectionCandidate
├── activeSelection
├── visibleSemanticRange
├── pendingTranslation
├── activeTranslation
├── activeHighlights
├── activeOverlay
├── workspacePanelState
└── navigationTarget
```

它是页面级交互状态，不是业务事实。

单文档 Reader 与 Book Reader 共用 Reader Shell。Book Reader 切换 Page 时保持 Book 阅读上下文与 Shell，但必须为目标 Document Revision 重建 Renderer 和 Coordinator 的 Revision 相关临时状态，具体规则见 [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)。

### Persistent State

ReadingProgress、Translation、LearningContext、Annotation、RecallAttempt、WorkspaceSession 和 WorkspaceTurn 由 Local Service 持久化。前端状态容器不是其权威来源。

## Renderer Interaction Contract

Coordinator 向 Renderer 发出命令：

```text
mount
navigateTo
setHighlights
clearSelection
updatePreferences
dispose
```

Renderer 向 Coordinator 发布事件：

```text
contentReady
selectionChanged
selectionCommitted
visibleRangeChanged
readingPositionChanged
linkActivated
renderFailed
```

Renderer 只报告交互事实，不能直接调用 Agent Runtime、Learning Repository 或数据库。

## Selection 提交流程

原生选区不能直接成为长期事实：

```text
Native Selection
      ↓ Renderer
Selection Candidate
      ↓ Content Layer 映射与校验
Validated SemanticSelection
```

`SelectionCandidate` 是临时且不可信的格式事件；`SemanticSelection` 是可进入 Translation、Learning、Annotation 和 Workspace Reference 的稳定对象。

完整链路：

```text
用户拖动选择
    ↓
Renderer 发布 selectionChanged
    ↓
Coordinator 更新临时 Candidate
    ↓
Renderer 发布 selectionCommitted
    ↓
NormalizeSelection Use Case
    ↓
Content Layer 校验 SemanticSelection
    ↓
Coordinator 确认当前选区未变化
    ↓
TranslateSelection Workflow
```

## 一期核心交互：选中即翻译

```text
SemanticSelection
    ↓
Context Extraction
    ↓
Controlled Translation Task
    ↓
Translation Result
    ↓
Translation Lens
```

规则：

- 只在选区稳定并通过校验后发起翻译；
- 用户拖动期间不能连续调用模型；
- Translation Result 必须绑定原 SemanticSelection 和 Operation；
- 新 Selection 采用 `latest-selection-wins`；
- Provider 支持取消时可以尝试取消旧 Invocation；
- 旧任务即使正常完成，也不能覆盖新选区的界面；
- 过期结果可以正常持久化和缓存；
- Translation 和 Recall Evaluation 一期等待完整结构化结果，不流式展示。

异步结果更新当前 UI 前必须核对：

```text
readerInstanceId
revisionId
selectionId
selectionFingerprint
operationId
```

## Translation Lens

Translation Lens 是锚定当前选区的紧凑结果界面：

- 优先展示简洁的语境翻译；
- 提供收藏和引用到 Workspace 操作；
- 不展示完整聊天输入；
- 不永久挤压正文布局；
- 用户点击气泡外部或按下 `Esc` 时隐藏；气泡内部滚动、点击和输入不能触发关闭；
- 页面滚动时气泡只跟随原语义范围的相对位置，不吸附或限制在当前视口内；原文范围滚出视图后，气泡也随之离开视图；
- 气泡位于文档正文之上，但低于左侧目录轨道、阅读进度栏和顶部 Header；滚动到顶部区域时由这些固定导航层自然覆盖；
- 已完成翻译直接高亮原文语义范围，用户点击对应词或短语即可恢复持久化结果，不在段落末尾追加独立 marker；
- 翻译高亮只裁剪视觉范围首尾空白，不修改持久化 SemanticSelection；默认使用轻量下划线，悬停或键盘聚焦时才显示背景；
- 当前阶段不展示原文语境区、声音入口和显式关闭按钮；
- 收藏必须基于已经完成的 Translation Result。

收藏形成的产品概念为：

```text
Learning Item
├── Expression
├── Translation Snapshot
├── Reading Context Snapshot
├── Source Location
├── Semantic Range
└── Content Revision
```

底层领域模型由 [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md) 定义。

## Contextual AI Workspace

Workspace 是 Reader 内部的悬浮或停靠式上下文工作空间，不是顶层 Chat 页面。

用户可以显式引用：

- 当前 Selection；
- 当前可见 Paragraph；
- 某次 Translation Result；
- 某个 LearningContext；
- 某个 Annotation；
- 某个历史 Workspace Turn。

```text
References + User Question
          ↓
Application Reference Resolver
          ↓
Context Bundle
          ↓
Agent Runtime
          ↓
Answer + Source References
```

Interaction Layer 只提交 Intent、Reference ID 和 User Input，不能直接拼装最终 Prompt。Reference Resolver 和 Context Builder 必须从 Local Service 的可信数据重新构建模型上下文。

Workspace 规则：

- 没有阅读上下文时不退化为无边界通用聊天；
- 不默认读取整份文档或本地全部数据；
- 用户可以看见当前问题引用了什么；
- 回答中的来源必须使用 Lumen 提供的 Reference ID；
- AI 不能凭空生成文档位置；
- 关闭或收起面板不改变 Reader 位置；
- 切换文档时不能暗中继承旧文档上下文；
- Workspace Answer 不自动成为 Learning Item 或 Annotation。

当前 Reader 通过统一 Overlay Manager 打开 Workspace。面板可拖动、最小化和关闭；Translation Lens 可以显式添加 Reference，面板内部还可添加当前 Selection、当前可见 Paragraph 和历史 Turn。每轮发送后清空待发送 References，关闭或重开仅恢复 Local Service 中属于当前 Document Revision 的 Session 与已完成 Turn，不保留未发送引用。

## 阅读中 Recall

Recall 采用：

> 默认轻量标记、用户主动触发、先回忆后反馈。

流程：

```text
当前可见语义范围命中已收藏表达
        ↓
显示不抢眼的下划线或背景标记
        ↓
用户点击命中的原文文字，打开锚定该范围的 Recall 气泡
        ↓
用户先输入自己的理解
        ↓
提交 Recall Evaluation
        ↓
展示判断、反馈和当前语境含义
        ↓
继续阅读
```

Recall 不自动弹窗，也不自动展示历史翻译。正常文本选择优先于 Recall 点击交互，用户可以关闭整体 Recall 或将单个表达设为 familiar。

Recall 不在段落结尾提供独立按钮。用户提交自己的理解后，判断、反馈和当前含义继续在同一锚定气泡内返回；关闭与滚动跟随规则和 Translation Lens 一致。

同一原文范围已存在 Translation Range 时，Coordinator 不再投影 Recall Match。已翻译位置以翻译记录为唯一交互；同一 Expression 在其他未翻译位置仍按 Recall 规则触发。Recall 默认使用与翻译不同的轻量下划线，仅在悬停或键盘聚焦时显示背景。

Renderer 只报告当前可见的 Semantic Block，Coordinator 按这些 Block 向 Local Service 查询匹配；服务端不得在每次滚动时扫描整篇文档。Recall 只针对文档当前活动 Revision，历史 Revision 保持只读浏览且不发起 Recall 查询，避免把当前学习状态错误投影到旧文本。

## Annotation

Annotation 由确定性 Application Use Case 创建和修改。写入前必须由 Content Layer 重建并校验 `SemanticSelection`，持久化完整 Revision、Semantic Range、原文快照与 Source Range 快照；模型不能直接创建、编辑或归档 Annotation。

Annotation 可以显式引用 Selection、Translation 或 LearningContext。其领域能力、API 和历史数据继续保留，但当前 Reader 页面暂不提供创建、展示或编辑入口；恢复页面接入前仍不得改写已确认的位置快照。

## Viewport 与 Reading Position

两者必须分开：

```text
Viewport
└── 当前屏幕可见的 Semantic Range

ReadingPosition
└── 可跨会话恢复的稳定阅读锚点
```

Viewport 用于 Recall、Translation Range 的增量查询、懒加载和可见高亮；ReadingPosition 用于保存进度和恢复阅读。Annotation 当前不接入 Reader 页面，因此不随 Viewport 查询。

```text
ReadingPosition
├── revisionId
├── semanticAnchor(blockId + offset)
├── sourceAnchor
├── progression
└── savedAt
```

不能只保存 `scrollTop`。Renderer 高频报告位置，Coordinator 立即更新 Reading Session State 中的当前进度供 Reader Shell 实时显示，同时节流后通过 Application Layer 保存；离开页面或进入后台时再补充保存。持久进度是跨会话恢复事实，不能被当作当前页面进度的唯一显示来源。

Reader 进入 Settings 时携带当前 Reader 内部路径；Settings 可以显式返回原阅读位置。直接打开 Settings 或返回地址不是合法 Reader 内部路径时，不展示该快捷入口。

## 边界约束

- 阅读区始终是主要工作区；
- AI 能力按需出现，不能长期占据阅读主体；
- 原生 DOM Selection、像素位置和临时 Renderer 对象不能进入业务数据；
- Coordinator 管理当前交互，但不能成为业务数据库的影子副本；
- Workspace 的业务历史由 Local Service 保存，面板位置和展开状态属于前端 Session；
- 所有写入动作必须经过明确 Application Use Case；
- AI 回答能够通过 Reference 反向定位原文，但不能自行修改原文或学习数据。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
