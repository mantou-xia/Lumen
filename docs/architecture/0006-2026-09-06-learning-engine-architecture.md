# Lumen Learning Engine 架构

创建时间：2026-09-06
最后更新时间：2026-09-09
状态：已确认

## 目的

本文定义 Lumen 一期学习引擎的产品边界、核心领域模型、表达聚合与变体规则、阅读中 Recall 流程以及学习状态。

## 核心定位

> Learning Engine 服务于持续阅读，不建立脱离阅读场景的复习系统。

学习引擎把真实阅读中发生的理解行为沉淀为能够再次遇见、回忆和查看的学习状态，其终点始终是让用户继续阅读。

```text
真实阅读
   ↓
选区翻译
   ↓
用户主动收藏
   ↓
Expression + LearningContext
   ↓
后续阅读再次命中
   ↓
用户主动 Recall
   ↓
AI 判断与反馈
   ↓
继续阅读
```

## 一期产品边界

一期不提供：

- 间隔重复算法；
- 每日复习任务和到期队列；
- 打卡、连续学习天数和任务完成度；
- 记忆曲线或遗忘概率；
- 独立刷卡、背词或复习中心；
- AI 自动宣布用户已经掌握某个表达。

Learning Library 只用于搜索、查看和管理阅读中积累的内容，不控制用户的复习节奏。

## 核心模型

```text
Expression
├── ExpressionVariant[]
├── LearningContext[]
├── RecallOccurrence[]
│   └── RecallAttempt[]
└── ExpressionStatus
```

### Expression

Expression 表示跨文档、跨语境聚合的标准学习对象：

```text
Expression
├── expressionId
├── canonicalForm
├── normalizedForm
├── expressionType
├── language
├── status
├── userNote
└── timestamps
```

一期 `expressionType` 保持有限：

```text
word
phrase
collocation
sentence
```

Expression 回答“用户正在学习什么”，但不能覆盖用户每次真实遇见时的表面形式和语境。

### LearningContext

LearningContext 是一次真实收藏形成的不可变学习证据：

```text
LearningContext
├── learningContextId
├── expressionId
├── documentId
├── revisionId
├── semanticRange
├── sourceLocation
├── surfaceForm
├── surroundingContextSnapshot
├── translationSnapshot
├── translationOperationId
├── status
└── createdAt
```

创建后不可原地改写的核心证据包括：

- 当时选中的原文；
- 当时的阅读语境；
- 当时显示的翻译与解释；
- 对应 DocumentRevision；
- Semantic Range 和 Source Location；
- 产生结果的 TranslationOperation。

后续重新翻译可以产生新结果，但不能静默改变既有 LearningContext。

Interaction Layer 中的 `Learning Item` 是产品概念：

```text
Learning Item = Expression + 当前 LearningContext
```

它不要求数据层存在一个吞并两者的单体实体。

### ExpressionVariant

ExpressionVariant 显式登记允许 Recall Matcher 使用的形式：

```text
ExpressionVariant
├── variantId
├── expressionId
├── surfacePattern
├── normalizedPattern
├── variantType
├── source
└── createdAt
```

`variantType`：

```text
canonical
observed
inflection
user_defined
```

`source` 可以是：

```text
learning_context
deterministic_normalizer
user
```

显式变体使系统能够解释“为什么这段文本被标记”，也允许用户修正错误匹配，而不必重写整个 Expression。

## 保守表达归一化

一期只采用高置信度、确定性的归一化：

- Unicode 规范化；
- 首尾空白清理；
- 连续空白折叠；
- 英文大小写归一化；
- 智能引号等明确标点形式统一；
- 明确词边界处理；
- 保留表达内部词序和原始 surfaceForm。

对单词可以使用确定性词形处理器或明确词典处理常见屈折变化。短语只允许大小写、标点、明确词形变化和已经登记的 Variant。

一期不使用 AI 自动决定 Expression 合并，不做模糊语义合并，也不建立同义词知识图谱。

同形表达可以存在多个 Expression，`normalizedForm` 用于索引和候选查找，但不构成全局唯一身份。

## 收藏与聚合流程

```text
完成的 TranslationOperation
        ↓
取得 SemanticSelection 与 TranslationResult
        ↓
生成 surfaceForm 和 normalizedForm
        ↓
执行保守候选匹配
        ├── 唯一、无歧义匹配 → 复用 Expression
        └── 无匹配或存在歧义 → 创建新 Expression
        ↓
检查 Revision + SemanticRange 是否已有相同 LearningContext
        ├── 已存在 → 幂等返回
        └── 不存在 → 创建 LearningContext
```

重复规则：

- 同一 Expression、同一 Revision、同一 Semantic Range：视为同一 LearningContext；
- 同一 Expression、不同原文位置：复用 Expression，新增 LearningContext；
- 语义相近但不同的表达：默认保持独立；
- 归档 Expression 再次被明确收藏时，可以按领域规则恢复为 active。

收藏是确定性业务写入，不在收藏过程中额外调用模型判断词典形式或是否合并。

## Reading Recall

Recall Matcher 对当前可见语义范围执行本地确定性匹配：

```text
Input
├── revisionId
├── visibleSemanticRange
├── activeExpressions
├── registeredVariants
└── matchingPolicy

Output
└── RecallMatch[]
    ├── expressionId
    ├── matchedVariantId
    ├── semanticRange
    ├── surfaceForm
    ├── matchType
    └── confidence
```

一期支持的可解释匹配类型：

```text
exact
case_insensitive
registered_variant
inflection
```

不使用模型扫描全文，不因滚动持续消耗 Token，也不输出语义相似的模糊命中。

### RecallMatch、RecallOccurrence 与 RecallAttempt

三者必须区分：

- `RecallMatch`：当前视口中的临时、可重建 Projection；
- `RecallOccurrence`：用户真正打开 Recall 交互时创建或复用的业务记录；
- `RecallAttempt`：用户提交自己的理解后形成的业务事实。

```text
Viewport
   ↓ Recall Matcher
RecallMatch（不持久化）
   ↓ 用户主动打开
RecallOccurrence
   ↓ 用户提交理解
RecallAttempt
```

页面滚动和普通高亮不能不断创建数据库记录。“看见过高亮”不是可靠学习事实。

## Recall Evaluation

用户必须先提交自己的理解，才能调用受控 AI Task：

```text
RecallEvaluationTask
├── expression
├── currentContext
├── selectedHistoricalContexts
├── userInterpretation
└── learningProfileSnapshot
```

结构化结果：

```text
RecallEvaluation
├── verdict
│   ├── understood
│   ├── partially_understood
│   └── misunderstood
├── feedback
├── contextualMeaning
└── missingPoints
```

模型只生成判断和反馈。Application Layer 校验结果并保存 RecallAttempt，模型不能直接改变 ExpressionStatus。

## ExpressionStatus

一期只保留简单、可解释的状态：

```text
active
familiar
archived
```

| 状态 | Learning Library | Recall 匹配 | 可新增语境 |
|---|---:|---:|---:|
| active | 是 | 是 | 是 |
| familiar | 是 | 默认降低或关闭提示 | 是 |
| archived | 可筛选查看 | 否 | 收藏时可恢复 |

`familiar` 表示用户希望减少提示，不表示系统证明已经掌握。状态由用户控制，系统可以提供建议，但不能根据少量 Recall 自动迁移为“掌握”。

## Learning Library

Learning Library 支持：

- 搜索 Expression 和 Variant；
- 按类型、状态和来源筛选；
- 查看多个真实 LearningContext；
- 查看当时的原文、语境和 Translation Snapshot；
- 跳转回来源 DocumentRevision 和位置；
- 编辑 Expression 的通用用户笔记；
- 设置 familiar 或 archived；
- 归档单个 LearningContext。

它不提供今日待复习、下一次复习时间或学习打卡。

一期实现中，列表查询由 Local Service 直接在 SQLite 中完成分页、排序、类型、状态、来源与关键词筛选；Web 不加载全部 LearningContext 后自行拼装。关键词覆盖 canonical form、normalized form、显式 Variant、Expression Note、LearningContext Note、语境原文与历史 Translation Snapshot。

表达详情以 Expression 为聚合入口，同时返回当前稳定 Lexical Profile 和全部历史 LearningContext。Expression 状态、Expression Note、LearningContext Note 与单条语境归档均通过显式 Application Use Case 写入；归档只改变业务状态，不删除 Translation、Operation 或历史快照。

返回原文必须携带 `documentId + revisionId + semantic range`。Reader 可以只读打开属于该文档的历史 Revision；历史版本不写入当前文档的 Reading Progress。

## 稳定词汇知识与语境快照

Lexical Profile 与 Translation、LearningContext 承担不同职责：Translation 记录一次真实选区在当前语境中的解释，LearningContext 固化用户收藏时看到的历史证据，Lexical Profile 则保存可跨文章复用、可按来源版本更新的词汇事实。更新 Lexical Profile 不得改写已有 Translation 或 LearningContext 快照。

一期词汇资料采用按需联网与本地持久缓存：

- Local Service 通过 English Wiktionary 的 MediaWiki API 按需读取带 revision id、revision timestamp 和原始 wikitext 的词条；
- Wiktionary 请求遵循显式外部 HTTPS 代理；Windows 未显式配置时读取当前用户系统代理。外部请求必须有独立超时上限，超时按来源不可用处理并优先回退本地缓存，不能无限占用 Reader 交互；
- Entry 匹配只使用 Unicode、大小写、空白、明确冠词移除和有限词形回退等确定性规则，不使用 AI 合并同形异义词；
- 原始 wikitext、规范化 Profile 与受控中文本地化结果分开保存；中文本地化按 `entryId + sourceRevisionId` 复用；
- AI 只本地化已解析出的英文事实，不补充英文义项，不改变义项顺序，也不作为稳定知识来源；
- 无网络时优先读取已有缓存；无缓存则显示资料不可用，语境翻译与阅读流程继续工作；
- 产品展示具体词条来源、Wiktionary 署名和 `CC BY-SA 4.0 / GFDL` 许可入口。

缓存更新采用显式刷新。来源 revision 变化时替换该 Entry 的事实 Profile，并使旧中文本地化失效后重新生成；历史阅读和学习快照保持不变。

## 边界约束

- 收藏必须来源于已完成并校验的 Translation Result；
- Learning Engine 不直接调用具体 Model Provider；
- Recall Matcher 只使用确定性规则；
- AI 只在用户主动提交理解后介入；
- Expression 聚合不能覆盖真实 surfaceForm 和上下文；
- LearningContext 的历史快照不能被后续模型结果改写；
- Learning Engine 记录学习证据，但不制造复杂熟练度分数；
- 所有学习交互完成后都应让用户返回当前阅读位置。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
