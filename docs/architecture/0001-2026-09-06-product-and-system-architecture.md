# Lumen 产品与总体系统架构

创建时间：2026-09-06
最后更新时间：2026-09-06
状态：已确认

## 目的

本文定义 Lumen 一期的产品边界、部署形态、顶层产品模块、逻辑分层和跨层依赖方向。各领域内部模型和 Contract 由关联架构文档维护，本文不重复其实现细节。

## 产品目标

Lumen 是面向真实材料的开源、本地阅读学习工具，首期覆盖英文阅读与技术学习两个场景，帮助用户完成以下循环：

```text
阅读真实材料
    ↓
遇到理解障碍
    ↓
获得恰好足够的语境帮助
    ↓
收藏值得积累的表达及真实语境
    ↓
后续阅读中再次遇见并主动回忆
    ↓
继续阅读
```

阅读始终是产品主体。AI 负责理解、翻译、解释、回答和判断，但不能替用户阅读，也不能把 Lumen 变成全文代读工具、孤立背词工具或通用聊天平台。

## 一期产品边界

Lumen 一期具备以下边界：

- 开源并由用户部署到自己的设备中使用；
- 面向单机、个人阅读场景；
- 不提供 Lumen 云服务、账号、租户或云同步；
- 所有文档、学习记录、运行记录和配置均由用户本地的 Local Service 管理；
- Web 是统一产品界面，Electron 复用同一套 Web 应用；
- 同时支持 Electron 一键安装和独立运行 Local Service 后由浏览器访问；
- 不为尚未发生的商业化、远程访问、多人协作或跨设备同步提前设计复杂机制。

“Web 优先”描述的是界面与开发技术栈，不表示数据部署在云端。

## 顶层产品模块

一期只有四个顶层产品模块：

```text
Lumen
├── Library
├── Reader
├── Learning Library
└── Settings
```

### Library

Library 是内容入口，负责文档导入、文档管理、最近阅读以及打开或继续阅读。

### Reader

Reader 是产品核心，负责原文阅读、目录与导航、场景化选区辅助、收藏学习项、Annotation、阅读中 Recall 和统一 AI Workspace。英文阅读与技术学习共享 Reader、Selection、Conversation 和受控 AI Runtime，具体能力由场景配置决定。

Translation、Recall 和 AI Workspace 都围绕当前阅读上下文工作，不拥有独立顶层入口。

### Learning Library

Learning Library 用于搜索、查看和管理阅读中积累的表达及真实语境，并允许跳回来源原文。它不是复习中心，不提供每日任务、打卡或间隔重复队列。

### Settings

Settings 管理阅读偏好、学习交互偏好、AI Provider、模型策略、本地数据目录及备份相关设置。

## 部署与运行形态

```text
                          共享产品核心
                               │
              ┌────────────────┴────────────────┐
              │                                 │
       Electron 一键安装                    独立部署
              │                                 │
     启动内置 Local Service           用户自行启动 Local Service
              │                                 │
      Electron 加载 Web UI              浏览器加载同一 Web UI
              └────────────────┬────────────────┘
                               │
                    SQLite + Managed Filesystem
```

Local Service 是可以脱离 Electron 独立运行的产品核心。Electron 仅负责进程管理、窗口、文件选择和受控桌面集成，不能拥有独立的业务逻辑或数据路径。

## 逻辑分层

```text
Web / Electron
      ↓
Interaction Layer
      ↓
Application Layer
      ↓
┌─────────────────────────────┐
│ Content / Document Layer    │
│ Learning Engine             │
│ Agent Runtime               │
└─────────────────────────────┘
      ↓
Data Ports
      ↓
SQLite / Managed Filesystem / Model Provider
```

各层职责如下：

- Product Layer 定义产品模块、用户目标和能力边界；
- Interaction Layer 表达用户意图并维护阅读交互；
- Application Layer 编排 Use Case、事务和长任务生命周期；
- Content / Document Layer 解释不同文档格式并提供稳定内容语义；
- Learning Engine 管理表达、真实语境和阅读中 Recall；
- Agent Runtime 执行受控 AI Task，但不决定业务数据如何改变；
- Data Layer 实现本地持久化、资源存储和运行记录。

## 跨层依赖原则

- Interaction Layer 不直接访问 SQLite、文件系统或 Model Provider；
- HTTP API 只转换协议，不承载 Use Case；
- Application Layer 可以编排多个能力，但不实现具体格式解析、学习规则或 Prompt；
- Content 和 Learning 不依赖 React、Electron、HTTP 或数据库实现；
- Agent Runtime 不直接创建 Learning Item、Annotation 或 RecallAttempt；
- Infrastructure 实现上层定义的 Port，不能反向控制领域模型；
- Electron 不能直接读写业务数据库和受管文档；
- Web 与 Electron 必须通过相同 Local Service API 使用业务能力。

## 一期明确不做

- Lumen 云端、账号、租户和云同步；
- 多用户协作和实时编辑；
- 脱离阅读上下文的通用聊天入口；
- 开放式 Agent Loop、任意 Tool Calling 和自主规划；
- 间隔重复、每日复习、打卡和复习算法；
- 微服务、消息队列和分布式基础设施；
- 向量数据库、CQRS 和完整 Event Sourcing；
- 为未来远程访问或同步预先实现复杂安全与冲突系统。

## 关联架构

- [内容与文档架构](0002-2026-09-06-content-document-architecture.md)
- [阅读交互架构](0003-2026-09-06-reading-interaction-architecture.md)
- [Application Layer 架构](0004-2026-09-06-application-layer-architecture.md)
- [Agent Runtime 架构](0005-2026-09-06-agent-runtime-architecture.md)
- [Learning Engine 架构](0006-2026-09-06-learning-engine-architecture.md)
- [Data Layer 架构](0007-2026-09-06-data-layer-architecture.md)
- [技术实现与模块架构](0008-2026-09-06-implementation-and-module-architecture.md)
