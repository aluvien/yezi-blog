# Aluvien's Blog

个人博客：文章、想法（类朋友圈短内容）、作品集与评论。前后台一体，数据存放在本地 SQLite（`better-sqlite3`），无外部服务依赖。

- 前台：首页内容流、文章详情（Markdown 排版）、想法、作品、关于、评论（无感防垃圾、审核后展示、作者回复）
- 后台：`/admin` 管理文章草稿与发布、想法、作品，以及评论审核、撤回和作者回复
- SEO：全站 metadata、Open Graph、`sitemap.xml`、`robots.txt`、`rss.xml`

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · better-sqlite3 · marked

## 本地开发

```bash
npm ci
cp .env.local.example .env.local   # 修改 ADMIN_PASSWORD 等配置
npm run seed                       # 可选：写入演示数据（仅空库时生效）
npm run dev                        # http://localhost:3000
# 生产模式：先 npm run build，再 npm start
```

后台入口 `http://localhost:3000/admin`，密码为 `.env.local` 中的 `ADMIN_PASSWORD`。

## 环境变量

见 `.env.local.example`：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 后台登录密码 | 无（必填） |
| `NEXT_PUBLIC_SITE_URL` | 站点对外 URL，用于 metadata / sitemap / RSS，末尾不带斜杠 | `http://localhost:3000` |
| `BLOG_DB_PATH` | 可选的 SQLite 绝对路径，适合容器挂载或隔离测试 | `data/blog.db` |
| `API_CORS_ORIGIN` | 可选的 App/Web API 跨域来源；不设置时允许公开读取 | `*` |

## App API

已预留版本化公开接口，基础地址为 `/api/v1`。接口只返回已发布文章、公开想法、作品和已审核评论，不暴露邮箱、IP 或后台字段。

```text
GET /api/v1                 # 接口发现与版本信息
GET /api/v1/posts           # 文章列表，支持 ?page=1&limit=20（limit 最大 50）
GET /api/v1/posts/:slug     # 文章详情与已审核评论
GET /api/v1/moments         # 想法列表，支持分页
GET /api/v1/works           # 作品列表，支持分页
POST /api/v1/comments       # 提交评论，沿用前台审核与限频规则
```

返回格式统一为 JSON；列表接口使用 `{ data, meta }`，后续新增接口时保持 `/api/v1` 版本不变，必要时再增加 `/api/v2`。

## 数据与上传文件

- SQLite 数据库：`data/blog.db`（首次运行自动建表）
- 后台上传的图片：`public/uploads/`

**这两个目录都需要在部署时持久化并定期备份。**

## 演示数据

```bash
npm run seed
```

插入 2 篇文章、3 条想法、2 个作品和几条评论。脚本会先检查表是否为空，非空则直接跳过，不会污染已有数据。

## 生产部署

### 方式一：PM2 + Nginx（VPS）

```bash
npm ci
npm run build
pm2 start ecosystem.config.js   # standalone server，端口 3000
pm2 save && pm2 startup         # 开机自启
```

Nginx 反向代理示例见 `deploy/nginx.conf.example`（含 `client_max_body_size` 上传大小限制）。上线后记得把 `NEXT_PUBLIC_SITE_URL` 改为正式域名并重新 build。

### 方式二：Docker（standalone 输出）

项目已配置 `output: 'standalone'`，`Dockerfile` 为多阶段构建：

```bash
docker build -t aluvien-blog .
docker run -d --name aluvien-blog -p 3000:3000 \
  -v blog-data:/app/data \
  -v blog-uploads:/app/public/uploads \
  aluvien-blog
```

注意：

- `better-sqlite3` 是原生模块，镜像内编译，请勿跨平台直接拷贝 `node_modules`。
- `/app/data`（数据库）和 `/app/public/uploads`（上传文件）必须挂卷持久化，否则容器重建后数据丢失。
- `NEXT_PUBLIC_SITE_URL` 是构建期内联变量，改域名需要重新构建镜像。
