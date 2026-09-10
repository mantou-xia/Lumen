# Lumen 上下文 AI Workspace 架构

创建时间：2026-09-10

最后更新时间：2026-09-10

状态：已确认

## 目的

本文定义 Lumen AI Workspace 的产品边界、格式无关原文引用交互、文档知识上下文、独立问答、多 Session、回答来源和持久化规则。本文是 Workspace 相关事实的主要维护位置；Reader、Application、Agent Runtime、Data Layer 和技术实现文档只维护各自边界并引用本文。

## 核心定位

> AI Workspace 是 Reader 内面向当前文档的可验证理解工作区，不是通用聊天页面、全文代读入口或开放式 Agent。

每轮问答由三个彼此独立的上下文来源组成：

```text
当前问题
├── 文档知识范围：默认启用，限定当前 Document Revision
├── 显式引用：可选，由用户主动加入并始终优先保留
└── 历史问答：默认不继承，只有显式引用时才加入
```

“每轮独立”表示模型不自动读取最近历史 Turn；“基于文档”表示即使没有显式引用，Workspace 仍可从当前 Document Revision 构建有来源的回答上下文。

## 产品边界

Workspace 可以：

- 解释、比较和归纳当前文档中的内容；
- 根据用户问题使用当前 Revision 的全文或检索出的语义块；
- 优先使用用户显式引用的原文、翻译结果或历史问答；
- 返回可点击、可回到原文的来源；
- 在同一 Document Revision 下创建和恢复多个独立 Session。

Workspace 不能：

- 自动搜索其他 Document、其他 Revision 或 Book 的其他 Page；
- 使用互联网、外部知识库、Tool Calling 或自主规划；
- 把模型常识伪装为文档事实；
- 直接创建或修改 Learning Item、Annotation、Recall 或原文；
- 自动继承整个会话历史；
- 把文档全文无条件发送给模型而绕过上下文预算。

当前 Book Reader 的知识范围只包含活动 BookPage 对应的 Document Revision。跨 Page 或整本 Book 问答需要未来独立设计范围选择和跨文档来源所有权。

## Workspace Session 与 Turn

同一 Document Revision 可以拥有多个 Workspace Session：

```text
DocumentRevision
└── WorkspaceSession[]
    ├── sessionId
    ├── titleProjection
    ├── createdAt
    ├── updatedAt
    └── WorkspaceTurn[]
```

规则：

- 首次打开 Workspace 时创建空 Session；
- 再次打开时恢复该 Revision 最后更新的 Session；
- 用户可以新建空 Session，并从轻量会话列表切换历史 Session；
- Session 标题由首个问题的确定性截断文本投影，不调用模型生成；
- 切换 Session 时清空未发送引用并退出原文引用态；
- 输入框有未发送问题时，交互层必须在切换前确认；
- 本阶段不提供 Session 删除、重命名、归档、搜索、Turn 删除或对话分支。

每个 Turn 默认独立：

```text
WorkspaceTurn
├── UserQuestion
├── ExplicitReferences[]
├── DocumentContext
├── Answer
└── Operation
```

历史 Turn 只有通过 `workspace_turn` 显式引用时才进入本轮 Context Bundle。界面展示历史不代表模型自动获得历史。

## 引用来源

Workspace Reference 分为：

```text
WorkspaceReference
├── explicit：用户主动加入的重点引用
└── retrieved：Context Builder 从当前文档选择的回答依据
```

显式引用当前开放：

- 原文单词；
- 原文句子；
- 原文语义块；
- Translation Result；
- 历史 Workspace Turn。

既有 `learning_context` 与 `annotation` Reference 的服务端解析能力可以保留，但在恢复相应用户入口前不作为本阶段主交互。

所有引用最终使用稳定语义身份：

```text
ReferenceSource
├── referenceId
├── provenance: explicit / retrieved
├── sourceType
├── documentId
├── revisionId
├── blockId
├── start / end
├── contentSnapshot
└── label
```

DOM Range、鼠标坐标、PDF TextItem、DOCX Run、EPUB iframe 节点和 CSS Selector 只能存在于 Format Renderer 内部，不能进入 API、Workspace 业务数据或持久化引用。

## 格式无关的原文引用交互

原文引用由 Reading Interaction Coordinator 管理模式，由 Format Renderer 负责本格式的命中和预览：

```text
Workspace
    ↓ 开启引用态
Reading Interaction Coordinator
    ↓ enterReferenceMode
Format Renderer
    ↓ referenceTargetChanged / referenceTargetCommitted
Semantic Reference Target
    ↓
Workspace Pending References
```

Renderer Contract 支持：

```text
ReferenceCapabilities
├── supported
├── granularities: word / sentence / block
├── hoverPreview
├── sideGutterTargeting
└── sourceMapping

ReferenceTarget
├── kind: word / sentence / block
├── revisionId
├── blockId
├── start / end
├── selectedText
└── bounds
```

不同格式可以使用不同物理命中方式，但必须输出相同的稳定语义目标：

- Markdown 可以通过 DOM Range、英文分词和语义块两侧感应区命中；
- PDF 后续通过文字层、页面坐标和 Source Mapping 命中；
- DOCX 后续通过 Paragraph / Run 投影映射为 Semantic Range；
- EPUB 后续在受限 Renderer 内部处理 iframe 事件并发布受控事件。

Workspace、Reader Shell 和 Coordinator 禁止直接访问 Markdown DOM、PDF 页面对象、DOCX XML 或 EPUB iframe 内部节点。

## Markdown 首期命中规则

Markdown 是首个实现引用态的 Format Renderer，命中优先级为：

```text
围栏代码块
  → 整个 code Semantic Block

语义块左右感应区
  → 整个 Semantic Block

英文单词内部
  → 单词 Semantic Range

词间空白、句内标点或句末标点
  → 所在句子 Semantic Range

不可读空白或装饰元素
  → 无引用目标
```

英文单词和句子优先使用 `Intl.Segmenter`；运行环境不支持时使用确定性英文回退算法。简单按空格或仅按句号分割不能作为正式规则，因为缩写、问号、感叹号、引号、小数和 Markdown 内联节点都会破坏这种假设。

代码块不做单词或句子命中。列表项、标题、引用块和表格单元格按自身 Semantic Block 边界处理，不把整个父列表或整张表隐式加入引用。

## 引用模式

Workspace 通过“从原文引用”进入引用态。引用态优先于正文中的翻译、Recall、链接和普通文本选择：

```text
引用态
├── Hover：显示临时 Reference Preview
├── 左键：提交当前目标
├── 文本拖选：不触发
├── 自动翻译：不触发
├── Translation / Recall 高亮：不激活
├── 文档链接：不跳转
└── Reader 顶栏与 Workspace：保持正常操作
```

`Reference Preview` 是 Renderer 临时高亮，不是 Translation、Recall 或 Annotation，也不进入持久化状态。预览不能改变排版、语义 offset 或正文文本节点顺序。

引用方式属于非敏感 UI Preference：

```text
referenceCaptureMode
├── single（默认）
└── continuous
```

- `single`：成功添加一个引用后退出；
- `continuous`：添加后继续，Reader 正文右键或 `Esc` 退出；
- 再次点击引用按钮、关闭 Workspace、切换 Session、切换 Revision、切换 BookPage 或离开 Reader 时退出；
- 相同 Revision、类型和语义范围的引用去重；
- 重叠但不相同的引用不自动合并，也不允许系统改写用户明确选择的范围。

## 指针与状态反馈

产品使用受控的普通指针资源；进入引用态后，Reader 正文使用变色引用指针。资源必须进入项目并参与构建，不能依赖开发者下载目录。

自定义指针不能覆盖必要的功能语义：输入框保留文本光标，拖动区保留拖动光标，禁用控件保留禁用光标。引用态除指针颜色外还必须显示文本状态提示，避免仅依赖颜色表达模式。

## 文档知识上下文

Workspace Context Builder 只读取当前 Document Revision 的 Semantic Projection，不读取 Render Projection 或具体格式源文件。

上下文初始使用约 48,000 字符总输入预算，保留系统协议、问题和安全余量后，约 36,000 字符用于显式引用与文档内容。字符预算是当前 Provider 无统一 Tokenizer 时的确定性基线，未来可以由 Token Estimator Port 替换。

预算优先级：

```text
必须保留
├── 当前问题
└── 全部显式引用及其来源身份

剩余预算
├── 当前文档全文，或
├── 检索语义块
└── 必要相邻语境与所属标题
```

显式引用整体超过允许预算时拒绝发送并提示用户移除引用，不能静默截断某个引用的一部分。

### 全文模式

如果剩余预算可以容纳当前 Revision 的全部可读 Semantic Block，则使用：

```text
contextMode: full_document
```

全文按稳定 `order` 排列，每个块保留 `blockId` 与来源身份。

### 检索模式

如果全文超过预算，则使用：

```text
contextMode: retrieved_document
```

流程：

```text
用户问题
  ↓ 受控查询改写：生成英文检索词
当前 Revision 的 Semantic Block FTS5
  ↓
相关块 + 相邻块 + 所属标题
  ↓ 去重、稳定排序、预算裁剪
Context Bundle
```

查询改写失败时降级为从原问题抽取英文、数字和专有名词直接检索，不能让辅助检索 Invocation 成为整个问答的单点故障。

FTS 索引属于可重建的格式无关 Projection，索引 `DocumentRevision SemanticBlock`，禁止命名或建模为 Markdown 专属搜索。未来 PDF、DOCX 和 EPUB 只要生成稳定 Semantic Projection，就复用相同检索边界。

## 严格文档回答

Workspace 默认使用严格文档模式：

- 回答只能依据显式引用和当前 Revision 的全文或检索结果；
- 不使用模型外部知识补充事实；
- 显式引用存在但文档检索无结果时，可以只根据显式引用回答；
- 没有足够依据时返回 `insufficient_evidence`，明确说明当前文档中未找到答案；
- `insufficient_evidence` 是成功完成的业务结果，不是 Provider 或 Operation 失败。

## Answer 与 Citation

正式 Answer 为：

```text
WorkspaceAnswer
├── content
├── outcome: answered / insufficient_evidence
├── contextMode: full_document / retrieved_document / explicit_references_only
├── citations[]
│   └── referenceId
├── contextStats
│   ├── explicitReferenceCount
│   ├── retrievedBlockCount
│   ├── includedCharacterCount
│   └── truncated
├── operationId
└── createdAt
```

回答内容使用受控 Markdown，允许段落、列表、强调、行内代码、围栏代码块和安全链接；原始 HTML、脚本、事件属性和不受控外部资源必须被禁用或清洗。

模型只能返回 Context Bundle 中存在的 Reference ID。完整输出通过 Schema 与引用白名单校验后，Answer、实际引用来源和 Context Stats 才能一起持久化。

回答正文和底部来源列表都可以点击回跳：

- 当前 Revision：导航到语义范围并短暂显示来源高亮；
- 同 Document 历史 Revision：明确提示后再打开历史版本；
- 无法定位：保留内容快照并提示位置不可用；
- 禁止静默切换 BookPage 或其他 Document。

## Application 与 Runtime 边界

Application Layer 负责：

- 创建、列出、打开和切换 Workspace Session；
- 解析显式引用；
- 创建 Workspace Operation；
- 调用文档 Context Builder；
- 保存完成的 Turn、Answer、来源快照和上下文统计。

Agent Runtime 负责：

- 查询改写与 `workspace.answer.v2` Task Definition；
- Context Budget 执行和版本化 Context Bundle；
- Prompt 编译、Provider 调用、有限技术重试和输出校验；
- Operation / Invocation 可观测性。

Format Renderer 只负责命中和视觉预览；Content Layer 负责根据 Semantic Projection 重建并验证引用；任何模型调用都不能发生在 Renderer 或 React 组件中。

## 持久化

SQLite 持久化：

- 多个 `workspace_sessions`，不再对 `document_id + revision_id` 设置唯一约束；
- `workspace_turns`；
- 显式与检索来源的不可变 Reference Snapshot；
- `workspace_answers` 的 outcome、context mode、context stats 与 citation snapshots；
- Workspace Operation 与所有 Invocation；
- 可重建的 Semantic Block FTS Projection。

历史 Workspace 快照绑定创建时的 Document Revision，不被新 Revision 或新回答静默覆盖。FTS 可以重建，不是文档内容的第二份权威事实。

## 当前非目标

- PDF、DOCX、EPUB 的具体引用命中实现；
- 跨 BookPage、跨 Document 或全库问答；
- 向量数据库与 Embedding；
- 互联网搜索、Tool Calling、自主规划和开放 Agent Loop；
- Session 删除、重命名、搜索、归档和对话分支；
- 自动会话摘要或 AI 标题；
- Provider 配置体系重构；
- Workspace 流式回答、取消和重新生成。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
