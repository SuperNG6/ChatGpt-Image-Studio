# ChatGpt Image Studio

ChatGpt Image Studio 是一个单仓库交付的图片工作流项目：

- `backend/`：Go 后端，负责 API 与静态资源托管
- `web/`：Next.js 前端，构建后静态导出到 `web/out`
- `scripts/`：统一的构建、开发、检查脚本

项目的交付方式是“一个服务统一承载前后端”：前端构建产物输出到 `web/out`，后端直接托管它，不需要把前端和后端拆成两个独立产品部署。

## 核心功能

- 基于 `gpt-image-2` 的文本生图
- 参考图生成与连续编辑
- 选区涂抹式局部重绘
- 图片放大与增强
- 本地认证文件导入与账号池管理
- 额度查询与刷新
- 与 CLIProxyAPI 兼容的 CPA 双向同步

## 仓库结构

```text
.
├── backend/                  Go 后端
│   ├── api/                  HTTP 路由与处理器
│   ├── internal/             配置、账号、同步、中间件
│   ├── data/                 运行时数据目录（默认不入库）
│   ├── config.defaults.toml  默认配置
│   └── main.go
├── web/                      Next.js 前端
├── scripts/                  build / dev / check 脚本
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 环境要求

- Go `1.26+`
- Node.js `24+`
- npm `10+`

## 快速开始

### 1. 准备本地配置

先复制示例配置：

```powershell
Copy-Item backend/data/config.toml.example backend/data/config.toml
```

```bash
cp backend/data/config.toml.example backend/data/config.toml
```

最小本地配置：

```toml
[app]
auth_key = "chatgpt2api"
```

如果需要接入 CPA 同步：

```toml
[sync]
enabled = true
base_url = "http://127.0.0.1:8317"
management_key = "your-cliproxy-management-key"
provider_type = "codex"
```

### 2. 启动开发环境

Windows：

```powershell
./scripts/dev.ps1
```

macOS / Linux：

```bash
chmod +x ./scripts/*.sh
./scripts/dev.sh
```

默认地址：

- `http://127.0.0.1:7000`

健康检查：

- `GET /health`

## 构建

Windows：

```powershell
./scripts/build.ps1
```

macOS / Linux：

```bash
./scripts/build.sh
```

构建产物：

- 前端静态文件：`web/out`
- 后端二进制：`dist/`

## 验证

Windows：

```powershell
./scripts/check.ps1
```

macOS / Linux：

```bash
./scripts/check.sh
```

当前检查项：

- `go test ./...`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`

## Docker 部署

一键构建并启动：

```bash
docker compose up --build
```

说明：

- 服务默认监听 `7000`
- `./backend/data` 会挂载到容器内 `/app/backend/data`
- 本地认证文件、同步状态、本地配置都保存在宿主机，不会丢失

## 主要接口

### 应用基础

- `POST /auth/login`
- `GET /version`
- `GET /health`

### 账号管理

- `GET /api/accounts`
- `POST /api/accounts`
- `POST /api/accounts/import`
- `DELETE /api/accounts`
- `POST /api/accounts/refresh`
- `POST /api/accounts/update`
- `GET /api/accounts/{id}/quota`

### 同步

- `GET /api/sync/status`
- `POST /api/sync/run`

`/api/sync/run` 支持两个方向：

- `pull`：从 CPA 拉取本地缺失账号与不一致状态
- `push`：把本地缺失账号与不一致状态同步到 CPA

### 图片接口

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/images/upscale`
- `GET /v1/models`
- `GET /v1/files/image/{filename}`

## 本地数据与敏感信息

以下内容默认不会提交到 Git：

- `backend/data/config.toml`
- `backend/data/accounts_state.json`
- `backend/data/auths/*.json`
- `backend/data/sync_state/*.json`
- `backend/data/tmp/`
- 构建产物、日志、临时文件、本地二进制

不要提交认证文件、管理密钥、运行状态或日志中的敏感内容。

## 认证文件导入规则

导入认证文件时，系统按 `账号身份 + 账号类型` 判重，而不是只按 token 判重。

身份优先级：

- `account_id`
- `chatgpt_account_id`
- `user_id`
- `email`

时间优先级：

- `last_refresh`
- `last_refreshed_at`
- `updated_at`
- `modified_at`
- `created_at`

如果账号身份和类型相同，则保留更新的一份。

## 发布与交付

- GitHub CI：`.github/workflows/ci.yml`
- Docker 交付：`Dockerfile` 与 `docker-compose.yml`
- 安全反馈说明：`SECURITY.md`

## 许可证

本仓库使用 MIT 许可证，详见 [LICENSE](LICENSE)。
