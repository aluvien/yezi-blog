# Yezi's Blog

个人博客：文章、想法（类朋友圈短内容）、作品集与评论。前后台一体，数据存放在本地 SQLite（`better-sqlite3`），无外部服务依赖。

- 前台：首页内容流、文章详情（Markdown 排版）、想法、作品、关于、评论（无感防垃圾、审核后展示、作者回复）
- 后台：`/admin` 管理文章草稿与发布、分类、附件、想法、作品，以及评论审核、撤回和作者回复；站点设置可修改页头、页脚和 Logo
- SEO：全站 metadata、Open Graph、`sitemap.xml`、`robots.txt`、`rss.xml`

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · better-sqlite3 · marked

## 本地开发

```bash
npm ci
cp .env.local.example .env.local   # 修改 ADMIN_PASSWORD 等配置
npm run seed                       # 可选：写入演示数据（仅空库时生效）
npm run dev                        # http://localhost:3030
# 生产模式：先 npm run build，再 npm start
```

后台入口 `http://localhost:3030/admin`，密码为 `.env.local` 中的 `ADMIN_PASSWORD`。

管理员登录内置暴力破解保护：同一来源连续 5 次失败会锁定 15 分钟；全站账户在 15 分钟内累计 25 次失败也会锁定 15 分钟。使用反向代理时请正确配置 `X-Real-IP`，并仅在确实信任代理时开启 `TRUST_PROXY`。

> 注意：直连访问（未配置 `X-Real-IP`/`X-Forwarded-For`）时，来源 IP 会被统一记为 `unknown`，所有此类访客共享同一评论限频与点赞去重键。生产环境务必通过反向代理提供 `X-Real-IP`，以保证限流按真实访客生效。

## 环境变量

见 `.env.local.example`：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 后台登录密码 | 无（必填） |
| `NEXT_PUBLIC_SITE_URL` | 站点对外 URL，用于 metadata / sitemap / RSS，末尾不带斜杠 | `http://localhost:3030` |
| `BLOG_DB_PATH` | 可选的 SQLite 绝对路径，适合容器挂载或隔离测试 | `data/blog.db` |
| `API_CORS_ORIGIN` | 可选的 App/Web API 跨域来源；不设置时仅允许同源访问 | 空（同源） |
| `TRUST_PROXY` | 是否信任 `X-Forwarded-For` 的首个地址；仅在代理已覆盖客户端请求头时开启 | `false` |

## App API

已预留版本化公开接口，基础地址为 `/api/v1`。接口只返回已发布文章、公开想法、作品和已审核评论，不暴露邮箱、IP 或后台字段。

```text
GET /api/v1                 # 接口发现与版本信息
GET /api/v1/posts           # 文章列表，支持 ?page=1&limit=20（limit 最大 50）
GET /api/v1/posts/:slug     # 文章详情与已审核评论
GET /api/v1/moments         # 想法列表，支持分页
GET /api/v1/works           # 作品列表，支持分页
GET /api/v1/feed            # 文章与想法的统一时间流，支持分页
GET /api/v1/categories      # 分类列表
GET /api/v1/search?q=关键词  # 搜索文章与想法，支持分页
GET /api/v1/interactions?target_type=post&target_id=1 # 阅读/点赞统计
POST /api/v1/interactions   # body: { target_type, target_id, kind: "view" | "like" }
POST /api/v1/comments       # 提交评论，沿用前台审核与限频规则
```

返回格式统一为 JSON；列表接口使用 `{ data, meta }`，后续新增接口时保持 `/api/v1` 版本不变，必要时再增加 `/api/v2`。

## 数据与上传文件

- SQLite 数据库：`data/blog.db`（首次运行自动建表）
- 后台上传的图片：`public/uploads/`

**这两个目录都需要在部署时持久化并定期备份。** 可使用 `npm run backup` 生成带时间戳的 SQLite 备份；备份目录不要直接暴露到 Web。

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
pm2 start ecosystem.config.js   # standalone server，端口 3030
pm2 save && pm2 startup         # 开机自启
```

Nginx 反向代理示例见 `deploy/nginx.conf.example`（含 `client_max_body_size` 上传大小限制）。上线后记得把 `NEXT_PUBLIC_SITE_URL` 改为正式域名并重新 build。

### 方式二：Docker（standalone 输出）

项目已配置 `output: 'standalone'`，`Dockerfile` 为多阶段构建：

```bash
docker build --build-arg NEXT_PUBLIC_SITE_URL=https://your-domain.com -t yezi-blog .
docker run -d --name yezi-blog -p 3030:3030 \
  -v blog-data:/app/data \
  -v blog-uploads:/app/public/uploads \
  yezi-blog
```

注意：

- `better-sqlite3` 是原生模块，镜像内编译，请勿跨平台直接拷贝 `node_modules`。
- `/app/data`（数据库）和 `/app/public/uploads`（上传文件）必须挂卷持久化，否则容器重建后数据丢失。
- `NEXT_PUBLIC_SITE_URL` 是构建期内联变量，务必在 `docker build` 时用 `--build-arg` 注入正式域名（见上方示例），否则镜像内为空、SEO 绝对链接会失效；改域名需要重新构建镜像。
