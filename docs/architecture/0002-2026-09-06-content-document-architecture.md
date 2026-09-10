# Lumen 内容与文档架构

创建时间：2026-09-06
最后更新时间：2026-09-10
状态：已确认

## 目的

本文定义 Lumen 对 PDF、Markdown、TXT、DOCX、EPUB 等文档格式的统一接入方式、投影模型、稳定定位能力和文档版本边界。

## 核心原则

> 格式差异封装在 Format Module 内，产品能力建立在统一内容抽象之上。

Lumen 不为每种格式维护一套完整产品逻辑，也不为了形式统一而牺牲格式原生能力。不同格式可以采用专属解析和渲染技术，但 Selection、Context、Progress、Translation、Recall、Learning Engine 和 Agent Runtime 只依赖统一 Contract。

## Format Module

一种格式由三个相互匹配的部分组成：

```text
Format Module
├── Service-side Document Adapter
├── Client-side Format Renderer
└── Shared Format Contract
```

### Service-side Document Adapter

运行在 Local Service 中，负责：

- 根据文件签名、媒体类型、扩展名和内部结构检测格式；
- 轻量检查文档元数据、能力和导入警告；
- 校验来源内容；
- 提取嵌入资源；
- 生成 Semantic Projection；
- 准备 Render Projection；
- 生成 Source Mapping；
- 校验导入产物。

Adapter 输出暂存的 `ImportArtifact`，不能自行把结果提交为正式 Document。正式提交由 Application Layer 协调。

概念 Contract：

```text
DocumentAdapter
├── formatId
├── detect(sourceProbe)
├── inspect(source)
├── import(source, options)
├── buildSemanticProjection(source)
├── buildRenderProjection(source)
├── buildSourceMapping(source)
├── extractResources(source)
└── validateProjection(result)
```

### Client-side Format Renderer

运行在 Web UI 或 Electron Renderer 中，负责：

- 尽量还原对应格式的原文排版；
- 呈现页面、章节和嵌入资源；
- 捕获格式原生选区；
- 报告可见范围和阅读位置；
- 显示统一语义高亮；
- 将语义位置映射回阅读画面；
- 释放格式私有资源。

Renderer 不直接触发翻译、收藏、Recall Evaluation、Agent Runtime 或数据库写入。

### Shared Format Contract

前后端通过共享协议约定：

```text
DocumentFormatDescriptor
├── formatId
├── adapterVersion
├── semanticProjectionVersion
├── renderProjectionVersion
├── sourceMappingVersion
└── supportedCapabilities
```

共享协议只包含稳定格式标识、能力、版本和序列化结构，不能包含 React、Node 文件对象或具体数据库实现。

## 三种内容投影

每个 Document Revision 同时拥有三种相互关联的投影：

```text
原始文档
   ↓
Document Adapter
   ├── Render Projection
   │   └── 用户实际看到的原文排版
   ├── Semantic Projection
   │   └── 系统用于理解和学习的统一语义结构
   └── Source Mapping
       └── 原始来源、渲染位置与语义位置之间的映射
```

### Render Projection

Render Projection 是格式相关投影，不要求所有格式使用相同结构：

- PDF 可以保留页面、文字层、字体、坐标、图片和链接；
- Markdown 使用 CommonMark + GFM 解析，可以保留 Heading、List（含任务列表）、Blockquote、Code、Table、删除线、自动链接和 Image；原始 HTML 仍需经过安全清洗。
- Markdown 围栏代码块在声明受支持语言时，由 Adapter 使用复用的 Shiki 高亮器生成多主题 Render Projection；未声明或不支持的语言保持纯文本，不进行自动语言猜测。高亮只增加可信的视觉 Token，不得改变代码纯文本、Semantic Block 或 Source Mapping。
- EPUB 可以保留 Spine、章节、HTML、CSS 和资源关系；
- DOCX 可以保留 Paragraph、Run、Table、Image 和 Style；
- TXT 使用自然段和纯文本布局。

### Semantic Projection

Semantic Projection 为上层提供统一结构：

```text
Document
└── DocumentRevision
    ├── Outline
    └── SemanticBlock[]
        ├── blockId
        ├── parentBlockId
        ├── blockType
        ├── order
        ├── text
        ├── semanticAttributes
        └── sourceMappingRef
```

公共 `blockType` 只包含真正跨格式成立的语义，例如：

```text
heading
paragraph
list
list_item
blockquote
code
caption
footnote
table
table_cell
image
separator
```

格式专属的大型排版信息不能不断塞入公共 Block，应保留在 Render Projection 或格式私有投影中。

### Source Mapping

Source Mapping 连接三种坐标：

```text
Render Location
      ⇅
Semantic Location
      ⇅
Original Source Location
```

上层统一使用：

```text
SemanticPoint
├── blockId
└── offset
```

格式内部来源位置可以是带类型的联合结构：

- PDF：页码、文字项范围、Bounding Boxes；
- Markdown：AST Path、Source Range；
- EPUB：Spine Item、CFI；
- DOCX：Part、Element Path；
- TXT：Source Range。

统一的是定位和双向映射能力，不是强迫所有格式共享同一种原始坐标。

## 核心实体

### Document

Document 表示用户认知中的一份材料：

```text
Document
├── documentId
├── formatId
├── title
├── author
├── activeRevisionId
├── status
└── timestamps
```

Document 不直接拥有可变 Blocks，而是通过 `activeRevisionId` 指向当前可阅读版本。

### DocumentRevision

DocumentRevision 表示对某一份来源内容的一次不可变解释：

```text
DocumentRevision
├── revisionId
├── documentId
├── sourceResourceId
├── contentHash
├── adapterVersion
├── semanticProjectionVersion
├── renderProjectionVersion
├── sourceMappingVersion
├── capabilities
├── status
└── createdAt
```

Revision 进入 `ready` 后，核心内容和稳定位置不能原地改写。重新解析或改变语义拆分规则时创建新 Revision，历史学习数据继续引用原 Revision。

## Capability

格式描述符声明理论支持能力，具体 Revision 声明当前材料实际具备的能力：

```text
DocumentCapabilities
├── selectableText
├── stableSourceLocation
├── nativeOutline
├── pagination
├── reflow
├── originalLayout
├── embeddedResources
├── search
└── annotations
```

Capability 必须按 Revision 确认。例如带文字层的 PDF 可以支持稳定选区，扫描 PDF 则可能只能显示原版页面，不能假装具备相同能力。

## SemanticSelection

跨层稳定选区定义为：

```text
SemanticSelection
├── selectionId
├── documentId
├── revisionId
├── start(blockId + offset)
├── end(blockId + offset)
├── selectedText
├── sourceRanges[]
└── fingerprint
```

规则：

- Selection 必须属于同一 Revision；
- 支持能够稳定映射的跨 Block 选区；
- offset 不能切断 UTF-16 代理项；
- Content Layer 根据 Block 内容重建并校验选中文本；
- 无法稳定映射的选区不能进入 Translation 或长期学习数据；
- 异构区域是否允许跨越由 Adapter Capability 和 Selection Policy 决定。

## 版本变化规则

- 仅优化 Adapter 内部性能且输出不变：不创建新 Revision；
- 仅改变可重建的渲染缓存：不必创建新 Revision；
- 改变 Semantic Projection：必须创建新 Revision；
- 改变会影响稳定位置的 Source Mapping：必须创建新 Revision；
- 升级 Renderer 但不改变稳定 Contract：可以只重建 Render Projection。

## 边界约束

- Product、Learning 和 Agent Runtime 不判断具体文档格式；
- Reader Shell 不操作 PDF 页面或 EPUB iframe 等格式私有对象；
- Adapter 不提交业务事务；
- Renderer 不直接写入业务数据；
- Block ID 和 offset 只在指定 Revision 内稳定；
- 原始像素坐标、DOM Range 和滚动位置不能成为长期学习身份；
- 新增格式原则上只新增对应 Format Module，不修改上层学习与 AI 流程。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
