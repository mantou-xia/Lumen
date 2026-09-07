# Lumen 技术实现与模块架构

创建时间：2026-09-06
最后更新时间：2026-09-06
状态：已确认

## 目的

本文定义 Lumen 一期的主技术栈、Local Service 运行结构、模块依赖、前端组织与状态、Electron 边界、客户端通信以及不可信文档内容的安全隔离。

## 一期技术栈

一期采用：

> TypeScript Monorepo + React Web UI + Electron 薄壳 + Node.js/TypeScript Local Service。

```text
Monorepo
├── Web Application
├── Electron Desktop
├── Local Service
└── Shared Contracts / Domain / Utilities
```

Web 与 Electron Renderer 共享同一套前端应用；Electron 和独立部署使用同一个 Local Service；前后端共享受控协议与运行时 Schema，但不能通过共享包突破模块边界。

## Local Service：模块化单体

Local Service 一期采用单进程模块化单体：

```text
Web / Electron UI
        ↓
┌──────────────────────────────────────┐
│          Lumen Local Service         │
│                                      │
│  API / Transport                     │
│          ↓                           │
│  Application Layer                   │
│          ↓                           │
│  ┌──────────┬──────────┬──────────┐  │
│  │ Content  │ Learning │ Runtime  │  │
│  └──────────┴──────────┴──────────┘  │
│          ↓                           │
│  Infrastructure Adapters             │
│  ├── SQLite                          │
│  ├── Managed Filesystem              │
│  ├── Secret Store                    │
│  └── Model Providers                 │
└──────────────────────────────────────┘
```

部署上是一个服务，代码上保持明确模块边界。一期不拆微服务、独立 Worker 服务、消息队列或分布式基础设施。

## Local Service 模块

```text
Local Service
├── API
├── Application
├── Content
├── Learning
├── Workspace
├── Agent Runtime
├── Settings
└── Infrastructure
```

### API

负责 HTTP 路由、Transport DTO 校验、错误映射、SSE 和文件流，不直接访问 Repository、解析文档或拼 Prompt。

### Application

按 Library、Reader、Learning、Workspace 和 Settings 组织 Use Case，负责显式编排与事务。

### Content

负责 Document、Revision、Resource、Format Adapter Registry、投影、Source Mapping、Selection 规范化和稳定上下文范围。

### Learning

负责 Expression、Variant、LearningContext、RecallMatcher、Occurrence、Attempt 和 ExpressionStatus。

### Workspace

Workspace 在产品上属于 Reader，在代码中属于具体产品能力，负责 WorkspaceSession、WorkspaceTurn、Reference 和历史选择。它调用 Agent Runtime，但不属于 Runtime 内部。

### Agent Runtime

负责 Task Registry、Context Compiler、Prompt Compiler、Provider Router、Invocation Executor、Schema Validator、缓存和 Telemetry，不拥有 Workspace 业务。

### Settings

负责阅读、学习、Provider、Model Policy 和数据目录相关设置。密钥通过 Infrastructure Secret Store Port 保存。

### Infrastructure

实现 SQLite Repository、Transaction Manager、Managed File Store、Provider Adapter、Secret Store、Clock、ID Generator 和 Logging 等上层 Port。

## 依赖规则

```text
API
 ↓
Application
 ↓
Domain Capabilities / Agent Runtime Ports
 ↓
Ports

Infrastructure
└── 实现 Ports
```

禁止依赖：

- Content → API；
- Learning → HTTP Controller；
- Agent Runtime → 具体 SQLite 表；
- Infrastructure → Application Use Case；
- Renderer → Learning Repository；
- Electron → SQLite；
- 前端 → Node 文件系统；
- Contract 包 → Application 或 Infrastructure 实现。

跨模块业务流程由 Application Layer 显式编排，派生索引与缓存失效可以使用有限的进程内事件。

## CPU 密集任务

Node.js 主事件循环负责 HTTP、SSE、Use Case 编排和 I/O，CPU 密集的 PDF 投影、文档解析或压缩处理必须进入受限 Worker Thread 或外部处理进程。

```text
Local Service
├── HTTP / SSE Event Loop
├── Document Worker Pool
├── Agent Invocation Executor
└── Maintenance Executor
```

文档解析和 Agent Invocation 使用不同的并发限制，不能共享无上限任务池。Worker 仍通过明确 Port 返回 Artifact，不能绕过 Local Service 数据所有权。

未来需要 Docling、OCR、Python 或原生工具时，将其作为 Document Processing Provider 接入，不改变 Document、Operation 和数据提交边界。

## Monorepo 与共享边界

概念布局：

```text
apps/
├── web
├── desktop
└── local-service

packages/
├── application-ui
├── reader
├── learning-ui
├── workspace-ui
├── api-client
├── api-contract
├── document-contract
├── content-domain
├── learning-domain
├── agent-runtime
├── application
├── infrastructure
└── platform
```

该结构只定义职责方向，实施时按真实代码规模逐步建立包，不能一次创建大量空包。

允许共享：

- 纯类型；
- 运行时 Schema；
- 稳定 Value Object；
- Error Code 和事件联合类型；
- 不依赖平台的确定性算法。

禁止通过共享：

- 前端导入 SQLite Repository；
- 后端导入 React 组件；
- Electron Renderer 直接导入 Node 文件系统；
- UI 实例化 Agent Runtime；
- API Contract 暴露数据库实体。

## 前端组织

前端按产品能力组织，而不是只按技术文件类型横向堆放：

```text
Frontend
├── app
├── library
├── reader
├── workspace
├── learning-library
├── settings
├── document-renderers
└── shared
```

Reader Shell、Interaction Coordinator、Translation Lens、Recall 和 Annotation 集中在 Reader 能力边界；各格式 Renderer 通过 Registry 注册，Reader Shell 不维护成串的文件类型判断。

```text
RendererRegistry
├── register(formatId, rendererFactory)
├── resolve(formatId, requiredVersion)
└── getCapabilities(formatId)
```

## 前端状态

状态分为四类：

```text
Frontend State
├── Server State
├── Reading Session State
├── Renderer Internal State
└── Ephemeral UI State
```

- Server State 是 Local Service 权威数据的客户端缓存；
- Reading Session State 由当前 Reader Instance 的 Coordinator 管理；
- Renderer Internal State 由格式 Renderer 私有维护；
- Ephemeral UI State 靠近组件保存。

不建立包含文档、Selection、Workspace、Settings 和全部弹窗状态的巨型全局 Store，也不把业务数据库复制成前端影子状态。

每个 Reader 页面或窗口创建独立实例：

```text
ReaderInstance
├── readerInstanceId
├── documentId
├── revisionId
├── InteractionCoordinator
├── RendererHandle
├── OperationSubscriptions
└── SessionState
```

所有异步交互通过 Reader Instance、Revision、Selection 和 Operation 身份校验后才能更新当前界面。

## Electron 边界

Electron 保持薄壳：

```text
Electron Main
├── 启动或连接 Local Service
├── 文件选择与导出位置
├── 窗口管理
├── 打开系统目录
└── 应用更新

Electron Renderer
└── 加载与 Web 相同的前端应用
```

平台差异通过 Platform Port 隔离：

```text
PlatformPort
├── selectImportFiles()
├── saveExportFile()
├── openExternalLink()
├── revealDataLocation()
├── getRuntimeEnvironment()
└── subscribeApplicationLifecycle()
```

产品代码不散落 `isElectron` 判断。Electron Main、Preload 和 Renderer 之间采用有限、显式能力接口，不能暴露通用 IPC 通道。

安全基线：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true（兼容范围内）
```

Preload 不能暴露 `window.require`、任意文件系统、任意 Shell 命令或通用 `send(channel, payload)`。

## 客户端通信

一期采用：

> HTTP JSON + 流式文件传输 + SSE + 持久化 Operation。

```text
Web / Electron UI
        ├── HTTP JSON：Command / Query
        ├── Streaming HTTP：上传、下载、Resource、Range
        └── SSE：Operation 状态和 Workspace Delta
```

一期不引入 WebSocket、GraphQL 或通用 RPC。

### Command 与 Query

HTTP Controller 只解析 Transport DTO、调用 Application Use Case 并映射结果。API DTO 面向具体 Use Case，不能直接暴露领域实体或数据库结构。

Web 和 Electron 使用同一类型安全 API Client，共享 Request、Response、Error Code、Operation Status、SSE Event Union、SemanticSelection 和 Reference Contract。

### Workflow 与 SSE

长任务通过持久化 `operationId` 观察：

```text
HTTP POST 发起 Workflow
        ↓
200 已完成结果，或 202 OperationReference
        ↓
SSE 接收状态 / 临时 Delta
        ↓
HTTP Query 读取权威最终结果
```

SSE 只提升实时体验，SQLite 和 HTTP Query 才是事实来源。事件可以重复或断开，客户端按 `operationId + sequence` 去重，并在刷新或重连后查询权威状态。

Workspace Delta 不逐 Token 永久保存；完整 Answer 通过校验后持久化。

### 文件和资源

上传使用 `multipart/form-data` 或 `application/octet-stream`，边写 staging 边计算 Hash，禁止 Base64 JSON。

Renderer 使用 `resourceId` 通过受控 Resource API 读取资源。Local Service 解析 storageKey、校验资源、设置媒体类型和缓存策略，并为大型资源支持 HTTP Range。API 不能暴露真实数据目录或接受任意路径拼接。

### 错误与幂等

统一错误模型：

```text
ApplicationError
├── code
├── message
├── details
├── retryable
├── operationId
└── traceId
```

前端按稳定 Error Code 处理，不解析错误字符串。响应不能包含堆栈、绝对路径、Provider 密钥或认证头。

关键写入通过幂等键或业务唯一约束保护，避免自动翻译、收藏、SSE 重连或双窗口导致重复数据。

## 不可信文档内容隔离

所有导入内容都视为不可信输入：

- Markdown 内嵌 HTML 默认净化或禁用主动内容；
- EPUB 内容运行在受限隔离环境；
- 文档脚本和 HTML 事件属性不得执行；
- 外部资源默认不能任意联网加载；
- 文档链接由 Reader Shell 受控处理；
- 文档内容不能访问 Electron Preload；
- Renderer 不能基于文档内容访问任意 Local Service 路径。

本地文件不天然可信，尤其不能让下载的 EPUB、Markdown 或 HTML 借助 Electron 获得本机系统权限。

## 一期明确不做

- 微服务与独立 Worker 服务；
- Redis、RabbitMQ、Kafka 等基础设施；
- WebSocket、GraphQL 和通用 RPC；
- 巨型全局前端 Store；
- Electron Main 或 Renderer 中的业务数据库访问；
- 为每个格式复制完整 Reader 产品逻辑；
- 把所有格式处理强制限制在 JavaScript 内部；
- 未经隔离执行文档脚本或开放任意系统能力。

## 关联架构

- [产品与总体系统架构](0001-2026-09-06-product-and-system-architecture.md)
- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)

