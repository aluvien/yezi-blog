# Yezi Blog 原生 App 管理 API

## 说明

管理 API 的根路径是 `/api/admin/v1`。它由 Next.js Route Handlers 提供 REST JSON 响应，供原生 iOS `URLSession` 等客户端直接调用；移动端不需要、也不应该加载后台 HTML、WebView 或 Next.js Server Actions 协议。

所有接口都读取现有的 `admin_session` HttpOnly Cookie，并通过 `requireAdminApi()` 鉴权。未登录时不会重定向到登录页，而是直接返回 JSON `401`。

除 session 的 `expires_at`（Unix 毫秒时间戳）外，时间字段均为 ISO 8601 字符串。文章响应中的 `tags` 是字符串数组；文章请求兼容现有 `PostInput` 的逗号分隔字符串，也接受字符串数组并在服务端规范化。

## 统一响应格式

成功响应：

```json
{
  "data": {},
  "meta": {}
}
```

列表响应的 `meta` 固定包含分页字段：

```json
{
  "page": 1,
  "limit": 20,
  "total": 42,
  "totalPages": 3
}
```

分页默认 `page=1&limit=20`，`limit` 允许 1–100。`page`、`limit`、状态值和资源 ID 不合法时返回 `400`。

失败响应：

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "用户可读的错误信息"
  }
}
```

常用状态码：`400` 参数或校验失败，`401` 未登录，`404` 资源不存在，`413` JSON 请求体过大，`500` 服务端处理失败。

## 认证

登录继续使用现有接口，登录成功后保存响应中的 `admin_session` Cookie：

```bash
curl -i -c /tmp/yezi-admin.cookies \
  -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}' \
  https://example.com/api/admin/login
```

新 API 不接受密码参数，也不会在任何响应中返回管理员密码或 Cookie 原始值。

### `GET /api/admin/v1/session`

请求不需要 body。成功响应：

```json
{
  "data": {
    "authenticated": true,
    "created_at": "2026-08-19T08:00:00.000Z",
    "expires_at": 1787126400000
  },
  "meta": {}
}
```

## 仪表盘

### `GET /api/admin/v1/dashboard`

成功响应的 `data`：

```json
{
  "posts": { "total": 42, "published": 35, "draft": 7 },
  "comments": { "pending": 2 },
  "moments": 18,
  "works": 6,
  "attachments": 73,
  "metrics": { "views": 1234, "likes": 98 },
  "recent_posts": [],
  "recent_comments": []
}
```

`recent_posts` 是最近 5 篇文章摘要，包含 `id/title/slug/cover/category/tags/status/created_at/updated_at/metrics`；`recent_comments` 是最近 5 条评论对象。

## 文章

### `GET /api/admin/v1/posts?page=1&limit=20&status=all&search=`

`status` 可选 `all`、`draft`、`published`；`search` 会匹配标题、Slug 和正文。列表中的每篇文章包含：

```json
{
  "id": 1,
  "title": "文章标题",
  "slug": "article-slug",
  "cover": "/uploads/202608/cover.webp",
  "category": "工程",
  "tags": ["Next.js", "iOS"],
  "status": "published",
  "created_at": "2026-08-19T08:00:00.000Z",
  "updated_at": "2026-08-19T08:00:00.000Z",
  "metrics": { "views": 10, "likes": 2 }
}
```

### `GET /api/admin/v1/posts/:id`

详情在上述字段基础上增加 `content`、`attachmentIds`、`referenceSnapshots`，并包含 `metrics`。

### `POST /api/admin/v1/posts`

请求 JSON 优先遵循现有 `PostInput`：

```json
{
  "title": "原生 App 管理 API",
  "slug": "native-admin-api",
  "content": "Markdown 正文",
  "cover": null,
  "category": "工程",
  "tags": "Next.js, iOS",
  "attachmentIds": [],
  "referenceSnapshots": [],
  "status": "draft"
}
```

`status` 只能是 `draft` 或 `published`。发布文章必须有正文。创建成功返回完整文章对象（包括新生成的 `id`）。

### `PATCH /api/admin/v1/posts/:id`

支持部分更新，字段与 POST 相同；未提交的字段保持原值。例如发布文章：

```json
{ "status": "published" }
```

成功返回更新后的完整文章对象。

### `DELETE /api/admin/v1/posts/:id`

请求不需要 body。文章及其评论、互动、引用关系按现有删除逻辑清理；成功返回：

```json
{ "data": { "id": 1 }, "meta": {} }
```

## 评论

### `GET /api/admin/v1/comments?page=1&limit=20&status=all`

`status` 可选 `all`、`pending`、`approved`。评论对象包含 `id/target_type/target_id/target_label/target_slug/nickname/email/website/content/status/created_at/admin_reply/replied_at`。出于最小化原则，不返回 IP 摘要字段。

### `PATCH /api/admin/v1/comments/:id`

请求格式：

```json
{ "action": "approve" }
```

```json
{ "action": "hide" }
```

```json
{ "action": "reply", "reply": "感谢你的留言。" }
```

`action` 只能是 `approve`、`hide`、`reply`。`reply` 可省略或传空字符串以清除已有回复，回复长度沿用现有校验，最多 1000 字。成功返回更新后的评论对象。

### `DELETE /api/admin/v1/comments/:id`

成功返回 `{ "data": { "id": 1 }, "meta": {} }`。

## 动态

### `GET /api/admin/v1/moments?page=1&limit=20`

成功返回动态数组和分页 meta。每项包含 `id/content/images/created_at/updated_at/metrics`，其中 `images` 是字符串数组。

### `POST /api/admin/v1/moments`

```json
{
  "content": "今天完成了原生 App API。",
  "images": ["/uploads/202608/photo.webp"]
}
```

沿用现有动态校验：内容最多 2 万字，最多 9 张图片，图片地址必须是站内 `/uploads/` 或 `http/https` 地址。

### `PATCH /api/admin/v1/moments/:id`

支持 `content`、`images` 部分更新，成功返回更新后的动态对象。

### `DELETE /api/admin/v1/moments/:id`

成功返回 `{ "data": { "id": 1 }, "meta": {} }`，并沿用现有动态删除清理逻辑。

## 作品

### `GET /api/admin/v1/works?page=1&limit=20`

返回作品数组和分页 meta。每项包含 `id/title/description/cover/link/sort_order/created_at`。

### `POST /api/admin/v1/works`

```json
{
  "title": "Yezi App",
  "description": "作品介绍",
  "cover": null,
  "link": "https://example.com",
  "sort_order": 0
}
```

### `PATCH /api/admin/v1/works/:id`

支持上述字段的部分更新；`link` 传空字符串表示移除链接。成功返回更新后的作品对象。

### `DELETE /api/admin/v1/works/:id`

成功返回 `{ "data": { "id": 1 }, "meta": {} }`。

## 分类和标签

### `GET /api/admin/v1/categories?page=1&limit=20`

返回分类数组，每项包含分类字段和 `posts_count`（已发布文章数），带标准分页 meta。

### `GET /api/admin/v1/tags?page=1&limit=20`

返回 `{ "tag": "iOS", "count": 3 }` 数组和标准分页 meta，统计包含草稿文章中已使用的标签，与现有后台分类页一致。

## curl 快速验证

```bash
BASE=https://example.com
COOKIE=/tmp/yezi-admin.cookies

# 未登录：必须是 401 JSON，不能是登录 HTML
curl -i "$BASE/api/admin/v1/dashboard"

# 登录并保存 admin_session
curl -i -c "$COOKIE" -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}' "$BASE/api/admin/login"

# 登录后访问
curl -i -b "$COOKIE" "$BASE/api/admin/v1/dashboard"

# 参数错误：必须是 400 JSON
curl -i -b "$COOKIE" "$BASE/api/admin/v1/posts?page=bad"
```

原生 iOS 客户端只需要让 `URLSession` 的 Cookie 存储保存 `admin_session`，后续请求发送 `Cookie` 即可；不需要 `API_CORS_ORIGIN`。部署时没有新增必需环境变量，仍需配置现有的 `ADMIN_PASSWORD` 和持久化 `BLOG_DB_PATH`；HTTPS 生产环境建议设置 `SESSION_COOKIE_SECURE=true`。
