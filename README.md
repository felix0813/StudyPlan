# StudyPlan

StudyPlan 是一个学习计划与学习记录管理服务。当前仓库包含：

- `backend/`：Go 服务端，所有 HTTP API 都以 `/study` 开头。
- `frontend/`：前端目录占位，暂未实现。

## 后端功能

- 创建/覆盖完整学习计划，学习计划是有序 JSON 对象数组。
- 查询完整学习计划、计划完成状态、下一个未完成学习内容。
- 修改学习计划条目的状态，支持 `incomplete`（未完成）和 `completed`（已完成）。
- 创建、重命名、删除学习记录标题，并维护标题更新时间。
- 查询标题列表。
- 在指定标题下批量上传 Markdown 学习记录文件。
- 查询指定标题下的所有文件元数据。
- 使用 PostgreSQL 存储计划、标题和文件元数据。
- 使用阿里云 OSS 存储 Markdown 文件内容。
- 提供 `/study/health` 健康检查，同时检查 PostgreSQL 与 OSS 可用性。
- 在启动、迁移、请求处理、关键数据变更和错误路径记录结构化 JSON 日志。

## 必需环境变量

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 无 | PostgreSQL 连接串，例如 `postgres://user:password@localhost:5432/studyplan?sslmode=disable`。 |
| `ALIYUN_OSS_ACCESS_KEY_ID` | 是 | 无 | 阿里云 OSS AccessKey ID。 |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | 是 | 无 | 阿里云 OSS AccessKey Secret。 |
| `ALIYUN_OSS_ENDPOINT` | 是 | 无 | OSS Endpoint，例如 `oss-cn-hangzhou.aliyuncs.com`。 |
| `ALIYUN_OSS_BUCKET` | 是 | 无 | OSS Bucket 名称。 |
| `OSS_PREFIX` | 否 | `study` | OSS 对象 key 前缀，服务会将文件写入该前缀下。 |
| `PORT` | 否 | `8080` | HTTP 服务监听端口。 |
| `SHUTDOWN_TIMEOUT_SECONDS` | 否 | `10` | 收到退出信号后的优雅关闭超时时间。 |

## 本地启动

```bash
cd backend
go mod download
DATABASE_URL='postgres://user:password@localhost:5432/studyplan?sslmode=disable' \
ALIYUN_OSS_ACCESS_KEY_ID='your-access-key-id' \
ALIYUN_OSS_ACCESS_KEY_SECRET='your-access-key-secret' \
ALIYUN_OSS_ENDPOINT='oss-cn-hangzhou.aliyuncs.com' \
ALIYUN_OSS_BUCKET='your-bucket' \
go run ./cmd/study-server
```

服务启动时会自动创建所需表结构。

## API 约定

- 请求与响应均使用 JSON，上传文件接口除外。
- 所有接口路径都以 `/study` 开头。
- 学习计划状态值：
  - `incomplete`：未完成
  - `completed`：已完成

### 健康检查

```http
GET /study/health
```

成功响应：

```json
{
  "status": "ok",
  "postgres": "ok",
  "oss": "ok"
}
```

如果 PostgreSQL 或 OSS 不可用，会返回 `503`，并在对应字段中放入错误信息。

### 创建/覆盖学习计划

```http
POST /study/plan
Content-Type: application/json
```

请求体是 JSON 对象数组：

```json
[
  { "content": "阅读 Go HTTP 标准库", "status": "incomplete" },
  { "content": "完成 PostgreSQL 连接池实践", "status": "completed" }
]
```

说明：

- 数组顺序就是学习计划顺序。
- `content` 不能为空。
- `status` 为空时会默认设置为 `incomplete`。
- 该接口会替换整个学习计划。

### 查询完整学习计划

```http
GET /study/plan
```

响应示例：

```json
[
  {
    "id": "plan_xxx",
    "position": 1,
    "content": "阅读 Go HTTP 标准库",
    "status": "incomplete"
  }
]
```

### 查询学习计划完成状态

```http
GET /study/plan/status
```

响应示例：

```json
{
  "total": 2,
  "completed": 1,
  "incomplete": 1
}
```

### 查询下一个学习内容

```http
GET /study/plan/next
```

返回第一个状态为 `incomplete` 的计划条目；如果全部完成，返回：

```json
{
  "item": null,
  "message": "all plan items completed"
}
```

### 修改学习计划条目状态

```http
PATCH /study/plan/items/{id}/status
Content-Type: application/json
```

请求体：

```json
{ "status": "completed" }
```

### 创建标题

```http
POST /study/titles
Content-Type: application/json
```

请求体：

```json
{ "name": "Go 学习记录" }
```

### 查询标题列表

```http
GET /study/titles
```

标题按 `updated_at` 倒序返回。

### 修改标题名称

```http
PATCH /study/titles/{id}
Content-Type: application/json
```

请求体：

```json
{ "name": "Go 进阶学习记录" }
```

### 删除标题

```http
DELETE /study/titles/{id}
```

删除标题会级联删除 PostgreSQL 中该标题下的文件元数据；OSS 对象保留，避免误删学习记录原文。

### 批量上传 Markdown 学习记录

```http
POST /study/titles/{id}/files
Content-Type: multipart/form-data
```

表单字段：

- `files`：一个或多个 `.md` / `.markdown` 文件。

示例：

```bash
curl -X POST http://localhost:8080/study/titles/title_xxx/files \
  -F 'files=@notes/day1.md' \
  -F 'files=@notes/day2.md'
```

上传成功后，文件内容写入 OSS，文件元数据写入 PostgreSQL，并更新标题的 `updated_at`。

### 查询某个标题下的所有文件

```http
GET /study/titles/{id}/files
```

响应示例：

```json
[
  {
    "id": "file_xxx",
    "title_id": "title_xxx",
    "filename": "day1.md",
    "oss_key": "study/titles/title_xxx/file_xxx-day1.md",
    "size": 1024,
    "content_type": "text/markdown; charset=utf-8",
    "created_at": "2026-05-06T00:00:00Z"
  }
]
```

## 存储说明

### PostgreSQL

服务自动维护以下表：

- `plan_items`：学习计划条目、顺序和状态。
- `titles`：学习记录标题、创建时间和更新时间。
- `study_files`：Markdown 文件元数据和 OSS key。

### 阿里云 OSS

Markdown 文件会写入：

```text
{OSS_PREFIX}/titles/{title_id}/{file_id}-{filename}
```

例如：

```text
study/titles/title_abc/file_def-day1.md
```

## 日志

后端使用 Go `slog` 输出 JSON 日志。以下关键节点会记录日志：

- 配置、PostgreSQL、OSS 初始化失败。
- 数据库迁移成功/失败。
- 服务启动与优雅关闭。
- 每个 HTTP 请求的 method、path、耗时。
- 学习计划替换、计划状态更新、标题创建/更新/删除、文件元数据保存、OSS 上传。
- 健康检查、数据库操作、OSS 操作等错误。
