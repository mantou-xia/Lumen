# 原文锚定 AI 阅读辅助架构

创建时间：2026-09-12

最后更新时间：2026-09-12

状态：已确认

## 目的

本文定义 Lumen 在英文阅读与技术学习两个场景中共用的 AI 阅读辅助底层，以及新的 Workspace、Conversation、原文引用、解释意图和 AI 注脚边界。

本文替代：

- [`0011-2026-09-10-contextual-ai-workspace.md`](0011-2026-09-10-contextual-ai-workspace.md) 中以独立 Session、引用模式和严格文档问答为中心的 Workspace 主交互；
- [`0012-2026-09-11-ai-workspace-validation-hold.md`](0012-2026-09-11-ai-workspace-validation-hold.md) 中针对旧 Workspace 形态的暂停决策。

`0011` 中与 Reference Snapshot、Operation、Invocation、来源回跳、安全 Markdown、Revision 绑定和持久化一致性有关的底层不变量继续保留，但以本文定义的 Conversation 和 Anchored Assistance 模型重新组织。

## 产品定位

Lumen 的 AI 是阅读过程中的即时辅助，不是独立聊天产品。Reader 页面始终保留一个不占用正文空间的 AI 悬浮球；用户点击后打开 Chatbot 风格悬浮面板，在当前阅读上下文中引用原文、提问、追问和查看历史回答。

AI 面板是统一交互容器，不能替代 Reader，也不能要求用户先进入复杂引用模式才能获得帮助。用户可以从正文选区直接发起翻译、解释、提问或收藏，也可以从面板主动添加一个或多个引用。

## 统一能力底层与场景配置

英文阅读和技术学习共用以下底层：

- Document / DocumentRevision / SemanticProjection；
- SemanticSelection 与稳定 Source Mapping；
- Conversation / Turn / Reference Snapshot；
- Context Builder 与 Context Policy；
- Capability Registry；
- Agent Runtime 的 Task Definition、Operation、Invocation、Provider 和 Schema 校验；
- AI 结果缓存、原文回跳、持久化和可观测性。

场景不复制一套 Workspace，而是通过 `SceneCapabilityProfile` 选择启用的能力：

```text
SceneCapabilityProfile
├── sceneId
├── enabledCapabilities[]
├── defaultAssistIntent
├── contextPolicy
├── allowedReferenceTypes[]
├── resultProjections[]
└── presentationActions[]
```

一期只实现内部 Capability Registry，不实现第三方动态代码插件。能力定义由产品代码注册，声明：

```text
CapabilityDefinition
├── capabilityId
├── supportedIntents[]
├── taskDefinition
├── inputSchema
├── outputSchema
├── allowedReferenceTypes[]
├── contextPolicy
├── persistencePolicy
└── projections[]
```

示例配置：

```text
EnglishReadingProfile
├── selection.translation
├── selection.language-explanation
├── anchored.question
├── expression.collection
└── expression.recall

TechnicalLearningProfile
├── selection.technical-explanation
├── anchored.question
├── technical-concept.collection
└── ai-footnote
```

场景配置只决定产品可见动作、默认意图、知识来源和结果投影，不改变 Selection、Conversation、Runtime 或数据层的基础 Contract。

## Workspace 交互

### 常驻悬浮球

Reader 页面始终显示 AI 悬浮球。悬浮球属于 Reader 的产品交互入口，不属于文档内容，也不写入文档来源。

点击悬浮球后打开悬浮面板，面板支持：

- 当前 Conversation 的消息列表；
- 当前原文引用卡片；
- 用户问题输入；
- 继续追问；
- 从正文添加引用；
- 从面板进入多引用捕获；
- 回答来源回跳；
- 场景能力快捷动作。

面板关闭只改变前端显示状态，不删除 Conversation、Turn 或 Anchored Assistance。切换 DocumentRevision、BookPage 或离开 Reader 时，当前临时选区和未提交引用必须清理；已持久化 Conversation 仍绑定创建时的 Revision。

### 从正文发起

普通文本选择完成后，Reader 可以显示场景相关的选区操作条，例如：

```text
[翻译] [解释] [提问] [收藏] [复制]
```

用户点击“解释”时，系统生成预设解释意图并直接提交；用户点击“提问”时，系统打开 Workspace，将当前 Selection 作为主引用放入输入区，等待用户填写问题。普通 Selection 本身不自动调用模型。

### 从 Workspace 发起

用户可以在输入框中直接提问，也可以点击“添加引用”从正文捕获一个或多个引用。多引用捕获是高级交互，不是单一原文解释的前置步骤。

## Conversation 与 Turn

Workspace 的核心持久化对象从“独立空白 Session”收敛为 Conversation：

```text
Conversation
├── conversationId
├── sceneId
├── documentId
├── revisionId
├── primaryAnchor?
├── createdAt
├── updatedAt
└── Turn[]
```

```text
Turn
├── turnId
├── userQuestion
├── intent
├── explicitReferences[]
├── contextSnapshot
├── answer
├── operationId
├── footnoteEligibility
└── createdAt
```

`primaryAnchor` 表示用户当前连续理解的主要原文位置，可以为空。Conversation 可以拥有多个 Turn，但后续 Turn 是否继承历史由 `ConversationContextPolicy` 决定，而不是由模型自行判断。用户在同一个锚定线程中继续追问时，系统可以携带必要的近期 Turn 和主锚点；跨主题或用户主动新建对话时，创建新的 Conversation。

历史 Turn 可以在面板中查看，也可以作为显式引用参与后续问题。但一旦本轮引用历史 Turn，回答默认不再自动投影为当前原文注脚。

## Reference 模型

统一引用仍使用稳定业务身份：

```text
Reference
├── referenceId
├── sourceType
│   ├── current_selection
│   ├── semantic_block
│   ├── translation_result
│   ├── learning_item
│   ├── conversation_turn
│   └── annotation
├── documentId?
├── revisionId?
├── semanticRange?
├── snapshot
└── provenance
```

当前原文 Selection、历史 Turn 和其他业务结果都可以进入 Conversation，但它们的来源身份不能混淆。Renderer、DOM Range、鼠标坐标、PDF TextItem、DOCX Run、EPUB iframe 节点和 CSS Selector 仍不能进入 API 或持久化业务数据。

多引用问题允许继续使用 Reference Resolver 和 Context Builder，但多引用只表达回答依据，不自动产生单一原文锚点。

## 意图判定

意图判定由 Interaction / Application Layer 使用确定性规则完成，不额外调用 LLM 判断“是否解释”。UI 显式动作具有最高优先级。

### 解释意图

以下情况归类为 `explain`：

1. 用户从正文选择一个当前原文 Selection，问题为空；
2. 用户点击“解释”或场景提供的等价快捷动作；
3. 用户问题明确表达解释含义、理解内容、展开说明、原理、原因、工作方式或代码逻辑等意图。

解释对象可以是词、短语、句子、语义块或代码片段，不要求必须是技术名词。技术场景使用 `selection.technical-explanation`，英文阅读场景使用对应的语言或句子解释能力。

### 非解释意图

用户明确请求翻译、总结、改写、比较、生成题目、生成答案、查证版本、跨文档检索或其他非解释操作时，归类为对应能力，不生成 AI 注脚。

引用历史 Turn、同时引用多个并列原文位置、或回答主要依赖多个来源时，保持为 Conversation Turn，不自动生成 AI 注脚，即使问题中出现“解释”字样。

意图优先级：

```text
明确 UI 动作
    > 明确非解释请求
    > 明确解释请求
    > 单一当前 Selection + 空问题的默认解释
    > 普通提问
```

模糊文本不使用模型二次分类。若用户通过“提问”入口提交，则按普通提问处理；若通过“解释”入口提交，则按解释处理。

## AI 注脚

### 定义

AI 注脚是解释型 Conversation Turn 在原文上的持久化投影，不是对原文的编辑，也不是普通 Annotation 的隐式替代。

```text
AiFootnote
├── footnoteId
├── documentId
├── revisionId
├── semanticSelection
├── selectedTextSnapshot
├── conversationId
├── turnId
├── explanationCapabilityId
├── status
└── createdAt
```

回答正文仍只保存一份，注脚通过 `turnId` 指向 Conversation Turn。注脚标记视觉上显示在选区尾部，但持久化必须绑定完整 `SemanticSelection`，不能把尾部像素坐标作为身份。

### 生成资格

只有同时满足以下条件，解释完成后才创建 `AiFootnote`：

```text
当前 DocumentRevision 中存在一个有效 SemanticSelection
+ 当前原文引用数量恰为一个
+ 没有引用历史 Turn
+ 没有其他并列原文或外部来源作为主依据
+ intent = explain
+ Answer 成功完成并通过 Schema 校验
```

用户取消、Provider 失败、超时、空回答、Schema 校验失败或只有 `insufficient_evidence` 时，不生成注脚。

### 标记与历史

同一 Revision、同一 SemanticSelection 和同一解释能力默认只显示一个活动标记。用户重新解释时保留历史 Turn，更新当前注脚投影指向；旧解释仍可从 Conversation 历史查看。注脚可以被用户显式删除，但删除投影不应误删 Conversation Turn，除非未来定义明确的联动删除规则。

注脚标记只在正文上投影，不改变 Markdown、PDF、DOCX、EPUB 或 TXT 的原始内容和 Render Projection。Renderer 通过稳定 Semantic Range 显示和命中标记。

## 上下文与知识来源

统一 AI Core 使用受场景和能力约束的 `ContextPolicy`，默认优先级为：

```text
当前用户问题或预设意图
    ↓
当前原文 Selection
    ↓
Selection 所在句子、语义块和标题路径
    ↓
Conversation 必要的近期历史
    ↓
场景允许的模型通用知识或外部来源
```

快速解释默认使用局部上下文，不自动加载整篇文档。普通 Chat 提问可以根据能力配置使用当前文档检索、历史 Turn 或用户显式引用。技术学习能力可以使用模型通用技术知识，但回答必须区分原文依据、模型补充和外部查证结果；英文阅读能力也不得把模型补充伪装成原文内容。

严格文档模式不再作为所有 Workspace Turn 的统一默认策略，而成为某些能力的显式 Context Policy。任何允许外部知识的能力都必须在 Task Definition 和回答结构中声明其知识边界。

## Application 与 Agent Runtime 边界

Application Layer 负责：

- 解析 UI Intent 和场景能力；
- 校验 Selection、Reference 与 Revision；
- 创建 Conversation Turn 和 Operation；
- 选择 Capability Definition 与 Context Policy；
- 决定回答完成后是否创建 AiFootnote 投影；
- 保存 Turn、Answer、Reference Snapshot 和注脚关系。

Agent Runtime 负责：

- 执行版本化 Task Definition；
- 编译 Prompt 和 Context Bundle；
- 调用 Provider；
- 执行有限技术重试和输出 Schema 校验；
- 记录 Operation / Invocation / Trace。

Renderer 和 React 组件不能直接调用模型，也不能直接写入 Conversation、Turn、AiFootnote 或其他业务数据。

## Agent Loop 边界

连续 Chat、原文引用、上下文检索和多轮追问不等于 Agent Loop。当前能力使用确定性受控 Workflow：

```text
解析 Intent / Reference
    ↓
构建 Context Bundle
    ↓
执行一个版本化 Task
    ↓
校验结构化输出
    ↓
保存 Turn / Answer / AiFootnote 投影
```

模型不能自主选择任意工具、任意改变业务数据或无限决定下一步。未来只有跨文档查证、复杂资料整理、代码验证或其他无法预先确定步骤的高级任务，才可以引入有最大步数、工具白名单、预算、超时和最终 Schema 校验的受控 Agent Run。Agent Run 不是 Workspace 默认执行模式。

## 持久化与兼容

现有 `workspace_sessions`、`workspace_turns`、`workspace_answers`、Reference Snapshot、Operation 和 Invocation 的数据不因本次重构直接删除。旧 Session / Turn 进入只读兼容读取路径；无法可靠确定单一主锚点的历史会话不得自动转换为 AiFootnote。

新写入使用 Conversation、Turn 和 AiFootnote 的新 Contract。若旧 Turn 明确只有一个当前原文引用，可以提供确定性迁移或用户主动转换；多引用、历史引用和无锚点 Turn 继续保留为普通历史。

数据库结构变化必须通过迁移完成，迁移不得覆盖旧 Revision 快照、回答来源或 Runtime Trace。所有正式回答和注脚关系仍由 Local Service 持久化，前端悬浮球和面板状态不是权威事实。

## 当前落地状态

截至 2026-09-12，本轮首个可用切片已经落地：

- 数据库 schema 23 为 Document、Book 增加 `scene_id`，并新增 Conversation、Turn、Reference、Answer 与 AiFootnote 表；旧 Workspace 表继续保留；
- 新写入使用 Conversation API，当前支持 `current_selection`、`paragraph` 和 `conversation_turn` 三类引用；
- Runtime 注册 `conversation.question.v1` 与 `selection.technical-explanation.v1` 两个版本化受控 Task，不执行开放式 Agent Loop；
- Reader 使用常驻 AI 悬浮球和 Chatbot 面板，技术学习场景关闭选区自动翻译，英文阅读继续保留原有翻译与 Recall；
- 空问题的单一当前选区，以及明确解释请求，会在回答成功后生成 AI 注脚；历史 Turn 引用或非解释请求不会生成；
- 注脚持久化绑定完整 SemanticSelection，Renderer 只在选区最后一个文本片段显示尾标，点击后恢复对应 Conversation。

架构中尚未落地的扩展引用类型、第三方能力插件、跨文档检索和受控 Web Search 仍属于后续能力，不应由当前 Contract 假定已经提供。

## 非目标

- 当前阶段不实现第三方动态代码插件市场；
- 不把 Workspace 改造成开放式 Agent Loop 或通用聊天平台；
- 不让模型直接创建、修改或删除 AiFootnote、收藏、Annotation 或其他业务数据；
- 不默认启用跨全库问答、向量数据库或无限制 Web Search；
- 不把所有回答自动生成正文注脚；
- 不为多锚点回答强行选择一个主注脚位置；
- 不删除旧 Workspace 历史数据或旧 Runtime Trace；
- 不改变 Format Renderer 的格式隔离和稳定 Selection Contract。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
- [上下文 AI Workspace 架构（已替代）](0011-2026-09-10-contextual-ai-workspace.md)
- [AI Workspace 场景验证与暂停扩展决策（已替代）](0012-2026-09-11-ai-workspace-validation-hold.md)
