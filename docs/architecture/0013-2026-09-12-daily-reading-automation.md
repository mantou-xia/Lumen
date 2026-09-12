# Lumen 每日阅读自动化架构

创建时间：2026-09-12

最后更新时间：2026-09-12

状态：已确认

## 目的

本文定义 Lumen 如何根据用户的自然语言阅读目标，从有限、受控的真实英文来源中每日选择一篇材料，忠实转换为 Markdown Document，并作为普通 BookPage 追加到普通 Book。本文是每日阅读自动化、来源策略、调度补偿、来源元数据和自动 Page 未查看状态的主要事实维护位置。

## 产品边界

每日阅读自动化解决“用户不知道今天读什么”的问题，但不替用户阅读。最终产物必须是用户可在 Reader 中完整阅读、选区翻译、收藏表达和继续学习的真实来源材料。

用户只需要提供：

- Book 标题；
- 一段自然语言阅读目标，例如学习背景、感兴趣领域和期望了解的方向；
- 每日本地执行时间。

平台使用版本化受控模板解释该目标。用户可以调整具体兴趣，但不能移除以下顶层限制：真实来源、忠实转换、来源可追溯、有限来源池、安全 Markdown、有限模型调用、有限网络访问和原子写入。

每日阅读自动化不是 Workspace Web Search，也不是开放式 Agent Loop。它是一个入口、来源和写入边界均由应用预先定义的持久化 Workflow。

## 核心模型

```text
Book
├── ordinary Book fields
├── DailyReadingAutomation?（一本 Book 最多一个）
└── BookPage[]
    ├── manual Page
    └── scheduled_reading Page

DailyReadingAutomation
├── automationId
├── bookId
├── interestDescription
├── interestProfileSnapshot?
├── localTime
├── timeZone
├── enabled
├── nextRunAt
├── lastAttemptAt?
├── lastSuccessLocalDate?
└── timestamps

DailyReadingRun
├── runId
├── automationId
├── operationId?
├── triggerReason
├── scheduledFor
├── localDate
├── status
├── selectedSourceSnapshot?
├── documentId?
├── pageId?
├── error?
└── timestamps

DailyReadingRunEvent
├── runId
├── sequence
├── stage
├── level
├── message
├── dataSnapshot?
└── createdAt
```

自动化 Book 与普通 Book 是同一个实体。暂停或删除自动化只删除未来追加能力，不删除已有 Document、BookPage 或阅读进度。

普通手动创建 Book 仍至少需要一个 Page。为了让用户在首次抓取无内容或失败时仍能看到并管理已经创建的自动化，允许且只允许绑定每日阅读自动化的 Book 暂时为零 Page；此时 Book 显示“等待首篇”，不能进入 Reader。首次成功后它与普通非空 Book 没有阅读行为差异。

## 受控来源池

首版不执行任意关键词 Web Search。Local Service 内维护版本化 `DailyReadingSourceRegistry`，每个来源 Adapter 必须声明：

```text
DailyReadingSourceDefinition
├── sourceId / version
├── publisher
├── discoveryEndpoints[]
├── allowedHosts[]
├── allowedContentTypes[]
├── attributionPolicy
├── articleExtractionPolicy
├── imagePolicy
├── requestBudget
└── enabled
```

来源 Adapter 只能访问注册表声明的公网 HTTPS 主机、发现入口和文章地址，且复用统一 Outbound HTTP Client 的代理、安全、重定向、超时和响应大小限制。网页中的任意链接、脚本、iframe、推荐内容或模型生成 URL 都不能扩展允许访问的主机集合。

首版启用以下受控来源，并通过固定样例验证通用 RSS、正文提取、图片排除和来源重定向边界：

1. MIT News 的 Artificial Intelligence 与 Robotics RSS：内容主题贴近 AI、具身智能和科研前沿，站点提供 RSS 与网页转载规则；正文保留标题、作者和 MIT News 署名，图片仅在文章明确提供可下载媒体及允许条件时纳管。
2. Global Voices English RSS：补充国际新闻、社会与技术语境；站点正文以 CC BY 3.0 为默认规则，必须保留作者、Global Voices 和原文链接，文章内第三方媒体按其单独标注处理。
3. NASA News / Science 的受控科技入口：补充机器人、航天、AI for Science 等材料；NASA 自有媒体可按官方使用规则处理，具有第三方版权标记的素材排除。

SciDev.Net 作为后续候选来源保留；只有在发现入口、正文结构和逐篇 CC Attribution 标记均能被稳定验证后才加入注册表，不作为首版启用来源。

来源注册表可以后续增加或暂停 Adapter，但不能通过配置让用户输入任意站点。来源条款、页面结构或内容质量明显变化时，先禁用对应版本并更新样例和策略，再恢复运行。

## 候选发现与选择

一次运行采用固定流水线：

```text
读取自动化配置与当日幂等状态
        ↓
并行读取受控来源发现入口
        ↓
确定性过滤：URL、时间、类型、篇幅、去重、来源状态
        ↓
受控 Agent Task 对有限候选做相关性与阅读价值排序
        ↓
按顺序提取并验证文章，直到得到一个合格结果
        ↓
忠实转换为 Markdown
        ↓
导入 Document 并原子追加 BookPage
```

模型只接收有限候选的标题、摘要、来源、发布时间和长度等元数据。模型不能访问网络、生成待抓取 URL、改写文章或决定图片权利；来源访问和规则判断始终由确定性代码负责。

兴趣解析和候选选择分别注册版本化 Task Definition。兴趣解析输出供用户查看的结构化理解快照，但原始自然语言描述仍是权威用户输入。候选选择输出必须引用输入候选 ID，不能产生集合外候选。

首版质量底线由来源样例确定，包括文章必须为英文、正文结构完整、非纯视频或播客页、非付费墙或登录内容、非转载片段，以及正文长度位于平台受控范围。没有合格文章时返回 `no_content`，不降低限制且不创建占位 Page。

## 忠实 Markdown 转换

每日阅读产物使用普通 Markdown Format Module。转换只允许：

- 提取标题、副标题、作者、发布日期、正文段落、正文标题、列表、引用、代码、表格、图片说明和必要脚注；
- 移除导航、广告、分享按钮、订阅框、评论、推荐阅读、追踪元素和脚本；
- 把网页结构确定性映射为项目支持的 Markdown；
- 在文档底部增加统一的来源信息区。

转换不得摘要、简化、翻译、续写、拼接多篇文章或改变原文措辞。若正文无法稳定提取、正文与页面元数据明显不一致或转换后完整性检查失败，该候选不合格。

统一来源信息区至少包含：

```text
Source title
Author（原站提供时）
Publisher
Published at（原站提供时）
Retrieved at
Original article link
Required attribution / license note
```

Document 同时保存结构化来源快照，Markdown 页脚用于用户阅读和导出时仍可追溯，结构化数据用于去重、审计和后续策略升级。

## 图片策略

图片是正文理解的一部分，但不能因为个人本地使用而取消来源判断。每张图片按文章中的署名、许可说明和来源 Adapter 的站点策略分类：

- `managed`：具有明确可用依据，下载到 Managed Filesystem，保留替代文本、标题、说明、作者或机构、许可标识和原始页面链接；
- `reference_only`：权利不明确或明确属于受限第三方，不下载、不缓存、不远程加载，在原位置保留说明和原文链接；
- `discarded`：广告、装饰、头像、Logo、追踪图、推荐卡片或与正文无关的媒体，直接移除。

AP、Reuters、Getty 等明确受限第三方图片不得因其出现在允许正文来源中而被纳管。系统不去水印、不寻找更高分辨率副本，也不把图片缺失视为正文导入失败。

## Workflow 与事务边界

每日阅读运行是持久化 Workflow，网络请求、模型调用和正文转换均在 SQLite 写事务外执行。正式提交采用短事务协调：

1. 再次校验自动化启用状态、目标 Book 和本地自然日幂等条件；
2. 提交已经由 Markdown Adapter 验证的 Document、Revision、来源快照和 Managed Resources；
3. 将 Document 追加为最后一个 BookPage，并标记 `origin = scheduled_reading`、`viewedAt = null`；
4. 保存运行成功终态和 `lastSuccessLocalDate`；
5. 推进下一次计划时间。

成功提交必须保证 Document、BookPage、来源快照、运行结果和 NEW 状态一起成立。失败不能留下正式可见 Document、孤立 Page 或错误 NEW。受管文件仍使用现有 staging、promote 与恢复机制。

## 时间、调度与补偿

自动化保存用户选择的 `HH:mm` 和浏览器报告的 IANA 时区。`nextRunAt` 保存为 UTC 时间戳；每次计划后根据该时区计算下一个本地自然日的目标时刻，避免把固定 UTC 偏移误当作长期时区规则。

创建自动化后立即产生一次 `initial` 运行。此后触发原因只有：

- `scheduled`：Local Service 持续运行并到达 `nextRunAt`；
- `startup_catchup`：Local Service 启动时发现已经错过计划时间；
- `manual_retry`：用户在失败或无内容后主动重试。

启动补偿只执行当前已到期配置的一次运行。即使错过多个自然日，也不逐日补齐；完成本次补偿后直接计算下一次未来计划。同一本 Book 在同一配置时区的同一本地自然日最多成功自动追加一个 Page，数据库唯一约束与 Application Layer 双重保护该规则。

进程内计时器只负责唤醒到期 Workflow，SQLite 中的配置和运行记录才是权威状态。首版不实现 Electron 后台常驻或操作系统计划任务；未来系统级调度只能调用 Local Service 的正式窄化入口，不能复制来源、模型或写入逻辑到外部脚本。

## 运行状态与恢复

运行状态限定为：

```text
requested → running → completed
                    ↘ no_content
                    ↘ failed
                    ↘ interrupted
```

Local Service 启动时把无存活执行者的 `running` 记录收敛为 `interrupted`，然后按自动化配置判断是否需要一次启动补偿。模型或网络失败只记录标准化错误，不自动无限重试；单次运行内部只允许 Task Definition 和来源 Adapter 声明的有限重试。

`manual_retry` 只在当天尚未成功时可用。成功后无论触发原因如何，当天不再自动或手动追加第二篇，避免重试按钮绕过每日一本一页的产品语义。

## Workflow 溯源

每日阅读的业务执行链与 Provider Invocation Trace 是两层不同事实。`DailyReadingRunEvent` 持久化一次运行从请求、兴趣解析、来源发现、候选排序、文章校验、Document 导入、Page 追加到终态的有序阶段；Agent Test 中的 Runtime Trace 继续记录兴趣解析和候选选择实际发生的模型调用。两层通过同一个 `operationId` 关联，避免把一次 Workflow 错误地展示为单次模型调用。

Workflow 事件只保存排查所需的受控元数据，包括来源 ID、候选 ID、标题、URL、筛选原因、结构化兴趣快照、Document/Page ID 和图片处理计数。事件不得复制文章全文、完整 Provider 原始响应、密钥、认证头或模型隐藏思维链。候选集合与事件数据必须保持有界，避免调试信息成为第二份内容存储。

Agent Test 提供独立的“每日阅读”Runtime Trace 筛选，并提供按运行查看的 Workflow 执行链。开发者可以从 Workflow 运行跳转到同一 `operationId` 下的兴趣解析与候选选择 Invocation，从而分别定位来源、确定性转换、业务提交或模型调用阶段的问题。普通启动不注册这些开发态查询入口，正式 Web 构建也不提供调试路由。

## NEW 与查看状态

自动新增 BookPage 初始 `viewedAt = null`。只要 Book 存在未查看的 `scheduled_reading` Page，Book 摘要就显示 NEW，并返回未查看数量。

以下行为清除单个 Page 的未查看状态：

- 用户从 Book Reader 实际打开该 Page；
- Book Reader 恢复时该 Page 是实际活动 Page。

只打开 Library、Book 目录或自动化配置不能清除 NEW；不要求读到页尾。手动新增或文件夹导入的 Page 默认已查看，不产生 NEW。

## API 与交互边界

每日阅读使用窄化 API：

- 创建自动化 Book；
- 获取和更新自然语言目标、时间、时区和启用状态；
- 暂停、恢复或删除自动化；
- 在允许时立即重试；
- 查询最近运行及结构化兴趣理解；
- 在打开具体 Page 时标记已查看。

创建自动化 Book 先在短事务中建立零 Page Book 与自动化配置，再异步启动首次运行，因此网络和 Provider 延迟不阻塞配置提交。API 返回 Book 和 Operation/Run 引用，Web 通过权威查询展示“正在寻找”“已更新”“今日无合适内容”或失败状态。

## 数据与幂等约束

新增持久化事实至少包括：

- `daily_reading_automations`：一本 Book 最多一条配置；
- `daily_reading_runs`：保存计划、本地日期、触发原因、终态和产物引用；
- `daily_reading_run_events`：保存单次运行的有序 Workflow 阶段与受控排查元数据；
- `document_sources`：保存原文标题、作者、发布者、发布时间、原始 URL、规范 URL、获取时间和署名策略快照；
- `book_pages.origin / viewed_at / daily_reading_run_id`：区分 Page 来源并维护 NEW；
- Markdown 图片的说明、署名、许可、使用依据和来源页字段。

关键唯一约束：

```text
daily_reading_automations: UNIQUE(book_id)
document_sources: UNIQUE(document_id)
document_sources: UNIQUE(canonical_url)
daily_reading_runs: 同一 automation_id + local_date 最多一个 completed
```

来源 URL 规范化和正文内容 Hash 同时参与候选去重，避免同一文章通过 Feed 参数、重定向或多个入口重复进入同一本 Book。

## 当前非目标

- 任意公开 Web Search 或用户自定义站点；
- 自动生成、摘要、简化、翻译或融合文章；
- 付费墙、登录态、浏览器自动化或反爬绕过；
- 历史日期逐日补齐；
- 打卡、连续天数、每日任务中心或间隔重复；
- Electron 后台服务和操作系统计划任务；
- 允许模型直接联网、下载图片或写入 Book；
- 为自动化 Book 建立第二套 Reader、Document 或 Book 模型。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
- [Book 编排与聚合阅读架构](0010-2026-09-10-book-composition-and-reading.md)
- [AI Workspace 验证与扩展暂停决策](0012-2026-09-11-ai-workspace-validation-hold.md)
