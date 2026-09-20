# Lumen Book 编排与聚合阅读架构

创建时间：2026-09-10

最后更新时间：2026-09-12

状态：已确认

## 目的

本文定义 Lumen 中单一 Document 与用户编排 Book 并存时的领域边界、Book Page 顺序、Reader 切换方式和聚合阅读进度。本文是 Book 相关事实的主要维护位置。

## 核心结论

> Document 是可独立阅读和复用的内容来源；Book 是对同一格式 Document 的有序编排，不复制、不合并也不改写 Document 内容。

用户既可以直接打开单一 Document，也可以把一份或多份同格式 Document 编排成 Book。同一 Document 可以加入多个 Book，并在不同 Book 中拥有独立的顺序与阅读进度。

当前只对 Markdown 开放用户创建 Book。未来 PDF、DOCX 等本身表达完整书籍或长材料的格式可以在导入流程中直接建立对应 Book，但不能因此移除底层 Document、DocumentRevision 和格式投影边界。

## 领域模型

```text
Document
├── 独立来源与元数据
├── DocumentRevision[]
└── 可被单独阅读

Book
├── bookId
├── title
├── formatId
├── status
├── BookPage[]
└── timestamps

BookPage
├── pageId
├── bookId
├── documentId
├── pageOrder
├── origin
├── viewedAt?
└── createdAt
```

BookPage 是成员关系实体，不是新的内容副本。它引用 Document，Reader 打开 Page 时读取该 Document 的活动 Revision。因此：

- Document 更新仍通过新 DocumentRevision 表达；
- Translation、LearningContext、Annotation、Recall 和 Workspace 继续引用 `documentId + revisionId`；
- 调整 BookPage 顺序不改变任何 Document Revision 或学习记录；
- 同一 Document 在不同 Book 中使用不同 `pageId`，因此可以保存彼此独立的 Book 阅读位置；
- 同一 Book 内不重复加入同一 Document，避免出现来源相同但身份难以区分的重复 Page；
- 普通手动创建 Book 至少包含一个 Page，创建时不能提交空集合；唯一例外是已绑定每日阅读自动化、尚未成功导入首篇材料的 Book，它可以暂时为零 Page 并显示“等待首篇”，但不能进入 Reader。

每日阅读自动化不创建新的 Book 类型。它通过可选配置绑定普通 Book，成功产物仍是普通 Markdown Document 和 BookPage；暂停或删除配置不影响已有 Page。具体来源、转换、调度和 NEW 规则由 [每日阅读自动化架构](0013-2026-09-12-daily-reading-automation.md) 定义。

## 格式一致性

一本 Book 内所有 Page 必须引用相同 `formatId` 的 Document。Book 在创建时固化 `formatId`，后续加入 Page 时继续校验。

当前产品只允许用户使用 Markdown Document 创建和编排 Book。该限制属于当前 Format Capability，而不是把 Book 领域写死为 Markdown。未来新增格式时：

- PDF、DOCX 等完整材料可以由导入 Use Case 同时创建一个单 Page Book；
- 格式原生页码、章节或 Spine 仍属于该 Document 的 Renderer 与投影，不与 BookPage 混为一谈；
- BookPage 始终表示 Book 编排层中的一个 Document 成员，而不是 PDF 的物理页或 DOCX 的排版页。

选择这一语义是因为不同格式的“页”并不稳定等价；BookPage 只解决多个 Document 的阅读编排，不侵入格式内部导航。

## Book 编排

创建 Book 时，用户提交标题和按期望顺序排列的 `documentIds`。Application Layer 在同一短事务中：

1. 校验标题与 Document 集合；
2. 校验所有 Document 均可阅读且格式相同；
3. 校验当前能力允许该格式创建 Book；
4. 创建 Book；
5. 按输入顺序创建 BookPage。

重新排序时，客户端必须提交 Book 当前全部 `pageIds` 的完整排列。Application Layer 校验集合完全一致后，在一个事务中重写连续的 `pageOrder`。不能接受缺失、重复或属于其他 Book 的 Page ID，因为部分排序会产生隐式删除或不确定顺序。

文件夹导入可以直接创建 Book：文件夹中每份 Markdown 仍是独立 Document，Book 标题取所选文件夹名称，Page 顺序按 Markdown 的完整根目录相对路径进行数字感知的自然排序。嵌套目录只参与排序和相对资源解析，不成为新的内容实体。

## Reader 入口与 Page 切换

Reader 支持两种显式上下文：

```text
StandaloneDocumentContext
└── documentId

BookReadingContext
├── bookId
├── activePageId
└── active Document / Revision
```

单文档入口保持原行为。Book 入口加载 Book 元数据、按顺序排列的 Page 摘要、当前 Page 对应的 ReaderDocument，以及 Book 阅读状态。

Book Reader 的切换方式限定为：

- 上一页；
- 下一页；
- Book 目录点击指定 Page；
- Page 内部继续使用该 Document 自身的 Outline 导航。

切换 Page 时 Reader Shell 不退出，但当前 Renderer、Interaction Coordinator、Translation Lens、Recall 状态和未发送 Workspace 引用必须按目标 Document Revision 重新建立，不能把上一 Page 的临时上下文带入下一 Page。已持久化的 Translation、Recall、LearningContext 和 Workspace 仍按目标 Document Revision 正常恢复或查询。

## 阅读进度

单文档进度与 Book 进度必须分开保存：

```text
Standalone ReadingProgress
└── keyed by documentId

BookPageProgress
└── keyed by bookPageId

BookReadingState
├── keyed by bookId
└── activePageId
```

这样同一 Document 被单独阅读、加入 Book A、加入 Book B 时，三个阅读上下文互不覆盖。

每个 BookPageProgress 保存当前活动 Revision 的稳定语义锚点与 Page 内 `progression`。Book 整体进度根据 Page 顺序与各 Page 的可阅读语义文本长度实时计算：

```text
bookProgression =
  (当前 Page 之前所有 Page 的权重
   + 当前 Page 权重 × pageProgression)
  / 全部 Page 权重
```

Page 权重取活动 Revision 中可阅读 Semantic Block 文本长度之和，最小为 1。使用内容长度加权而不是按 Page 数平均，是为了避免短序言与长章节占据相同进度比例。

重新排序后不保存旧的聚合百分比，而是根据新顺序重新计算；稳定事实是 Page 顺序、活动 Page 和 Page 内锚点。Document 产生新活动 Revision 后，如果旧进度锚点不属于新 Revision，则该 Page 从新 Revision 起点恢复，不能把旧 Block ID 强行套用到新内容。

## Library 与 API

Library 同时展示独立 Document 与 Book，不把创建 Book 解释为移动、归档或隐藏原 Document。

最小 Use Case：

- `ListBooks`；
- `GetBook`；
- `CreateBook`；
- `ImportMarkdownFolder`；
- `ReorderBookPages`；
- `OpenBook`；
- `UpdateBookReadingProgress`。

Book API 只接受 Document、Book 和 Page 的稳定 ID，不暴露数据库行或文件路径。单文档 Reader API 保持兼容，Book Reader 使用独立路由与 DTO，避免通过可选字段把两种进度所有权混在一起。

Library 在用户选择文件夹前说明推荐结构、编码、图片类型、路径边界与容量限制。文件夹导入响应同时返回创建的 Document 摘要和 Book，便于一次更新 Library；任一 Markdown 失败时，不返回部分结果。

## 数据一致性与生命周期

- Book、BookPage、BookReadingState 和 BookPageProgress 由 SQLite 持久化；
- BookPage 对 Document 使用限制删除，存在引用时不能静默物理删除 Document；
- BookPage 从 Book 移除时，可以删除其完全依附的 BookPageProgress；
- Book 归档不归档其中的 Document；
- Document 归档策略后续接入时必须检查 Book 引用并在界面明确反馈，不能留下不可见失效 Page；
- Book 编排不复制 Managed Resource，也不引入新的文档解析任务。
- 自动新增 Page 以 `origin = scheduled_reading` 标识并在首次实际打开前保持 `viewedAt = null`；手动 Page 默认不产生未查看状态。

## 当前非目标

- 跨格式混排；
- 同一 Book 内重复加入同一 Document；
- 连续滚动自动拼接多个 Renderer；
- Book 内全文合并、导出或生成新 Markdown；
- Page 内容编辑；
- 多用户协作编排；
- 用 Book 身份替代 Translation、LearningContext、Annotation 或 Workspace 的 Document Revision 身份。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [每日阅读自动化架构](0013-2026-09-12-daily-reading-automation.md)
