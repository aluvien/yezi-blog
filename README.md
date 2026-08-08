# Yezi's Blog

个人博客：文章、想法（类朋友圈短内容）、作品集与评论。前后台一体，数据存放在本地 SQLite（`better-sqlite3`），无外部服务依赖。

- 前台：首页内容流、文章详情（Markdown 排版）、想法、作品、关于、评论（无感防垃圾、审核后展示、作者回复）、全站音乐播放器
- 后台：`/admin` 管理文章草稿与发布、分类、附件、想法、作品，以及评论审核、撤回和作者回复；站点设置可修改页头、页脚、Logo 与音乐播放器；可接入自建 QQ Music API 扫码登录并搜索选歌
- SEO：全站 metadata、Open Graph、`sitemap.xml`、`robots.txt`、`rss.xml`

## 界面截图

截图使用本地生产模式生成，覆盖前台桌面端、前台手机端和后台手机端。后台截图中的仪表盘卡片、分类/标签管理、文章元信息、评论审核和站点设置均来自本地演示库。

### 前台桌面端

| 首页 | 文章详情 | 作品集 |
| --- | --- | --- |
| ![前台首页桌面端](docs/screenshots/frontend-home-desktop.jpg) | ![文章详情桌面端](docs/screenshots/frontend-article-desktop.jpg) | ![作品集桌面端](docs/screenshots/frontend-works-desktop.jpg) |

### 前台手机端

| 首页 | 文章详情 | 想法 | 作品集 |
| --- | --- | --- | --- |
| ![前台首页手机端](docs/screenshots/frontend-home-mobile.jpg) | ![文章详情手机端](docs/screenshots/frontend-article-mobile.jpg) | ![想法手机端](docs/screenshots/frontend-moments-mobile.jpg) | ![作品集手机端](docs/screenshots/frontend-works-mobile.jpg) |

### 后台手机端

| 仪表盘 | 文章管理 | 想法管理 | 作品管理 |
| --- | --- | --- | --- |
| ![后台仪表盘手机端](docs/screenshots/admin-dashboard-mobile.jpg) | ![后台文章管理手机端](docs/screenshots/admin-posts-mobile.jpg) | ![后台想法管理手机端](docs/screenshots/admin-moments-mobile.jpg) | ![后台作品管理手机端](docs/screenshots/admin-works-mobile.jpg) |

| 评论管理 | 分类与标签 | 站点设置 |
| --- | --- | --- |
| ![后台评论管理手机端](docs/screenshots/admin-comments-mobile.jpg) | ![后台分类与标签手机端](docs/screenshots/admin-taxonomy-mobile.jpg) | ![后台站点设置手机端](docs/screenshots/admin-settings-mobile.jpg) |

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
| `QQ_MUSIC_API_URL` | 自建 QQ Music API 的本机地址；后台扫码登录和 `qqvip` 音乐播放使用 | `http://127.0.0.1:3200` |
| `QQ_MUSIC_SESSION_PATH` | QQ 扫码会话文件路径；留空时放在数据库同目录，必须持久化且不可公开访问 | `data/qq-music-session.json` |

## 音乐功能

文章和想法都可以嵌入音乐；前台由一个全站播放器统一接管，因此从文章或想法切换页面时不会中断播放。后台“设置 → 音乐设置”可以设置默认歌单、随机播放与播放器位置。

### 在文章和想法中插入

文章使用独立的 `music` Markdown 代码块，一行一首或一个歌单：

````md
```music
netease:7785232779:playlist
qq:数字歌曲ID:song
```
````

想法正文中使用独占行标记：

```text
!music netease:123456789:song
```

常规格式为 `平台:ID:类型[:random]`：

| 字段 | 可选值 / 说明 |
| --- | --- |
| 平台 | `netease`、`qq`、`kugou`、`kuwo`、`xiami`、`baidu` |
| 类型 | `song`、`playlist`、`album`、`search` |
| `random` | 可选；打乱歌单顺序 |

后台文章和想法编辑器的“+ 音乐”按钮也支持手动填写上述格式。

### QQ 音乐扫码登录、搜索与播放

项目可选接入 [sansenjian/qq-music-api](https://github.com/sansenjian/qq-music-api)，用于使用自己的 QQ 音乐账号扫码登录、在后台搜索歌曲，并由本站服务端获取播放地址。

接入后：

1. 在“设置 → 音乐设置”点击“扫码登录 QQ 音乐”。
2. 用手机 QQ 扫码并确认；登录 Cookie 只保留在服务器的受限会话文件中，并仅通过本机请求头转给 QQ Music API。网站数据库和访客浏览器均不会保存或收到 Cookie。
3. 在文章或想法编辑器点击“+ 音乐 → QQ 音乐搜索”，选择歌曲即可插入。
4. 插入的格式为 `qqvip:歌曲MID:song`。前台播放时由本站 `/api/music/qq` 服务端接口临时解析播放地址，并带有限频保护。

`qqvip` 当前仅支持单曲。请仅使用自己拥有合法播放权限的账号，并留意 QQ 音乐的服务规则；第三方接口或上游登录机制变化后，可能需要重新扫码登录。

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
npm run demo:taxonomy
```

`npm run seed` 会插入 2 篇文章、3 条想法、2 个作品和几条评论；它会先检查表是否为空，非空则直接跳过，不会污染已有数据。

`npm run demo:taxonomy` 会幂等地补充技术实践、阅读笔记、音乐与影像等分类，并为演示文章写入 Next.js、Markdown、音乐、摄影等标签。它不会删除或覆盖想法、作品、评论和音乐设置，重复执行也不会生成重复分类。README 截图使用的本地数据包括 6 篇文章、4 条想法、2 个作品、5 条评论、5 个分类和 15 个标签；`data/` 与上传文件目录被 `.gitignore` 忽略，实际部署时请在目标环境单独初始化和持久化数据库。

## 生产部署

### 方式一：PM2 + Nginx（VPS）

```bash
npm ci
npm run build
pm2 start ecosystem.config.js   # standalone server，端口 3030
pm2 save && pm2 startup         # 开机自启
```

后台“同步 GitHub”按钮会在服务器项目目录中执行安全的 `git pull --ff-only origin main`，
同步前自动备份 SQLite，随后构建并重启 `yezi-blog`。它不会执行 `git reset --hard`、`git clean`、
`rsync --delete` 或复制数据库的操作。生产环境请在 `.env.local` 中配置 `BLOG_DB_PATH` 和 `UPLOAD_DIR`
的绝对路径，并确保服务器 Git 已配置 GitHub 访问凭证。

Nginx 反向代理示例见 `deploy/nginx.conf.example`（含 `client_max_body_size` 上传大小限制）。上线后记得把 `NEXT_PUBLIC_SITE_URL` 改为正式域名并重新 build。

### 可选：部署 QQ Music API（宝塔 / PM2）

QQ Music API 应作为博客之外的本机服务运行，**不要**放在博客 Git 工作目录中，避免博客同步代码时影响它的依赖或登录态。以下示例适用于宝塔面板已安装 Node.js 22 和 PM2 的服务器：

```bash
mkdir -p /www/wwwroot/services
cd /www/wwwroot/services
git clone https://github.com/sansenjian/qq-music-api.git
cd qq-music-api
npm ci
npm run build

PORT=3200 PM2_HOME=/root/.pm2 pm2 start npm \
  --name qq-music-api \
  --cwd /www/wwwroot/services/qq-music-api \
  -- run start
PM2_HOME=/root/.pm2 pm2 save
```

确认服务可用：

```bash
curl http://127.0.0.1:3200/getHotkey
```

博客默认连接 `http://127.0.0.1:3200`，无需额外配置；若服务端口不同，在博客 `.env.local` 中设置：

```bash
QQ_MUSIC_API_URL=http://127.0.0.1:3201
```

安全要求：

- 不要在宝塔防火墙开放 `3200`，也不要为这个 API 单独绑定公网域名。
- 只让博客服务通过 `127.0.0.1` 调用 QQ Music API；扫码、Cookie 查询和搜索接口均由博客后台管理员权限保护。
- `data/qq-music-session.json` 是登录会话文件，权限应为 `600`；它与 `blog.db` 一样需要保留在持久化目录，但绝不能提交到 Git 或暴露为静态文件。
- 更新此服务时只在它自己的目录执行 `git pull --ff-only`、`npm ci`、`npm run build`、`pm2 restart qq-music-api --update-env`；不要把 QQ Cookie 或其配置文件提交到博客仓库。

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
