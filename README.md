# Lumen

> Read. Understand. Remember.

Lumen 是一个面向真实英文材料的 AI 阅读学习工具。

它不替用户阅读，也不以全文翻译或机械背词为目标。当用户在阅读中遇到理解障碍时，Lumen 提供恰好足够的帮助，让用户看清当前语境并继续自主阅读。

**Lumen** 在拉丁语中与“光”有关，现代英语中也用于表示光通量。这个名字表达了产品的核心隐喻：AI 不替你给出答案，而是在理解被遮蔽时照亮文本。

```text
你阅读 → 遇到障碍 → Lumen 照亮 → 你继续自己阅读
```

## 产品定位

Lumen 面向有持续英文阅读需求的学习者，帮助他们阅读技术文档、书籍、论文、新闻和课程材料。

它关注三个彼此连接的过程：

- 在真实语境中理解词语和表达；
- 保存值得掌握的表达及其来源语境；
- 在后续阅读中再次遇见、回忆并逐渐掌握它们。

Lumen 不是全文翻译器、孤立生词本或通用 AI 聊天工具。AI 始终服务于阅读本身，用户仍然是理解和学习的主体。

## 核心循环

```text
Read
  ↓
Lumen
  ↓
Understand
  ↓
Remember
  ↓
Read again
```

## MVP 当前能力

当前 MVP 已跑通第一条完整阅读闭环：

```text
导入 UTF-8 Markdown
        ↓
保留语义排版进行阅读
        ↓
划词获得语境翻译
        ↓
收藏表达与当前语境
        ↓
后续阅读再次遇见
        ↓
主动 Recall 并获得反馈
```

当前支持：

- Markdown 文档导入、安全渲染、目录导航和阅读进度恢复；
- 单一 Markdown 文档独立阅读，以及将一份或多份文档编排为 Book 后按 Page 连续阅读；
- 同一语义块内的单词、短语和句子划选；
- DeepSeek 预设与通用 OpenAI-compatible 中转站；
- 表达收藏、真实语境保存和原文跳转；
- 当前阅读范围内的自动 Recall；
- SQLite 与 Managed Filesystem 本地持久化，无账号、无云端服务。

一期暂不包含 PDF、DOCX、EPUB、Electron 安装包、AI Workspace、全文搜索和间隔复习算法。

## 本地启动

### 环境要求

- Node.js 24 或更高版本；
- pnpm 11 或更高版本；
- Windows、macOS 或 Linux；
- 使用 AI 能力时，需要 DeepSeek API Key 或兼容 OpenAI Chat Completions 的模型服务。

确认环境：

```shell
node --version
pnpm --version
```

### 1. 安装依赖

在仓库根目录执行：

```shell
pnpm install
```

Windows PowerShell 如果受到脚本执行策略限制，请使用：

```powershell
pnpm.cmd install
```

### 2. 创建本机配置

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```shell
cp .env.example .env
```

`.env` 已被 Git 忽略，不会随普通 Git 提交进入仓库。

### 3. 配置模型

#### DeepSeek 预设

默认配置已经选择 DeepSeek。打开根目录 `.env`，只需填写 API Key：

```dotenv
LUMEN_AI_PRESET=deepseek
LUMEN_AI_API_KEY=你的DeepSeek密钥
```

该预设自动使用 Lumen 当前验证过的 DeepSeek 官方地址和模型，不需要填写 Base URL 或模型名称。

#### 通用中转站

使用 OpenAI-compatible 中转站或本地兼容服务时，改为：

```dotenv
LUMEN_AI_PRESET=openai-compatible
LUMEN_AI_BASE_URL=https://你的中转站地址/v1
LUMEN_AI_API_KEY=你的密钥
LUMEN_AI_MODEL=你的模型名称
```

`LUMEN_AI_BASE_URL` 不要包含 `/chat/completions`，Local Service 会自动附加该路径。不需要鉴权的本地服务可以让 `LUMEN_AI_API_KEY` 留空。

### 4. 启动应用

Windows PowerShell：

```powershell
pnpm.cmd dev
```

macOS / Linux：

```shell
pnpm dev
```

正常启动后终端会显示类似信息：

```text
[web] Local: http://127.0.0.1:4311/
[service] Server listening at http://127.0.0.1:4312
```

浏览器访问：

```text
http://127.0.0.1:4311
```

停止应用时，在运行终端按 `Ctrl+C`。

### 5. 开始体验闭环

1. 在文档库选择一个 UTF-8 编码的 `.md` 文件并导入；
2. 打开文档，在同一个段落中选择英文表达；
3. 等待 Translation Lens 返回语境翻译；
4. 点击“收藏这个表达”；
5. 打开另一篇包含相同表达的文档；
6. 点击自动出现的 Recall 标记，先写下自己的理解，再查看反馈。

## 端口与数据目录

默认地址：

| 服务 | 地址 |
|---|---|
| Web UI | `http://127.0.0.1:4311` |
| Local Service | `http://127.0.0.1:4312` |

Local Service 端口可以在根目录 `.env` 中修改：

```dotenv
LUMEN_PORT=4312
```

Vite 会读取同一个配置并自动更新 API 代理目标，不需要再修改源码。

默认权威数据保存在：

```text
.lumen-data/development/
```

可以通过 `.env` 改到其他目录：

```dotenv
LUMEN_DATA_DIR=D:\path\to\lumen-data
```

请不要在应用运行期间手工修改 SQLite 数据库或受管文档文件。

## 健康检查与故障排查

Local Service 健康检查：

```text
http://127.0.0.1:4312/api/health
```

正常响应示例：

```json
{
  "status": "ok",
  "service": "lumen-local-service",
  "version": "0.1.0",
  "database": {
    "status": "ready",
    "schemaVersion": 16
  }
}
```

### 页面显示 502 或服务尚未就绪

Web 与 Local Service 会并行启动，页面会在短时间内自动重试。若持续失败：

1. 检查终端是否出现 `Server listening at http://127.0.0.1:4312`；
2. 检查 `.env` 中的 `LUMEN_PORT`；
3. 检查端口是否被其他程序占用；
4. 修改为一个空闲端口后，完整停止并重新执行 `pnpm.cmd dev`；
5. 在浏览器使用 `Ctrl+F5` 强制刷新。

Windows 查看端口占用：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4312
```

如果页面提示“端口返回了非 JSON 内容”，说明该端口上的响应不是 Lumen，通常是被其他本地程序占用。不要直接结束不认识的进程，优先修改 `LUMEN_PORT`。

### DeepSeek 未配置

确认 `.env` 中已经填写 `LUMEN_AI_API_KEY`，保存后完整重启应用。密钥不会通过 Provider Status API 返回到 Web 页面。

## 开发验证

运行构建、Lint、类型检查和源码测试：

```powershell
pnpm.cmd check
```

运行真实浏览器端到端烟雾测试：

```powershell
pnpm.cmd test:e2e-smoke
```

端到端测试使用独立临时数据目录和受控 Provider Stub，不会调用你的真实模型密钥；测试结束后会清理临时数据和子进程。

## 项目结构

```text
apps/
├── web/             React Web UI
└── local-service/   本地业务服务

packages/
└── api-contract/    前后端共享运行时协议

docs/architecture/   公开且正式的架构决策
```

## 品牌表达

**Lumen — Read. Understand. Remember.**

**Lumen｜让阅读更深一点。**

AI 不替你阅读，而是给你一束光，让你看清原本看不懂的东西。

公开的产品架构与架构决策见 [`docs/architecture/`](docs/architecture/README.md)。
