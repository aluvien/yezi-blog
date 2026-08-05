# yezi-blog 优化清单（交接用）

> 状态标记：✅ 已完成并验证（lint + build 通过，接口/页面已跑冒烟测试）｜⏭️ 未实施（需单独决策/排期）
> 改动范围：`src/lib/db.ts`、`src/app/(site)/posts/page.tsx`、`src/app/api/v1/{posts,moments,works,feed,search}/route.ts`、`src/lib/markdown.ts`、`src/app/api/admin/upload/route.ts`、`src/app/(site)/archives/page.tsx`、`README.md`、`package.json`（新增 sanitize-html + @types/sanitize-html）

---

## 🔴 P0 — 高优先级（性能随数据量退化）

### ✅ P0-1 数据库层支持分页（LIMIT/OFFSET）

**问题**：`listPosts()`/`listMoments()`/`listWorks()` 均为 `SELECT *` 无 `LIMIT`，首页/归档/搜索/RSS/feed 全部一次性取全量到内存再 `slice`。

**已实施**：
- `src/lib/db.ts` 三个函数新增可选参数 `{ limit, offset }`，SQL 层 `LIMIT/OFFSET`（better-sqlite3 支持绑定，已用真实库验证分页正确）；不传参仍返回全量，兼容内存过滤型调用方。
- 新增 `countPublishedPosts()`（`db.ts`）。
- 文章列表页 `src/app/(site)/posts/page.tsx` 改为 SQL 分页（`listPosts({ limit: current * PAGE_SIZE })`），总数用 `countPublishedPosts()`。
- API `posts/moments/works` 路由改为 SQL 分页 + `countPublishedPosts/countMoments/countWorks` 算 total。
- RSS 与 sitemap 保持全量输出（未分页，符合预期）。

**保留内存合并的调用方（含注释说明取舍）**：首页/归档（跨类型合并时间流）、feed 接口、search（先过滤再分页）。

---

### ✅ P0-2 公开 API 的评论数/metrics N+1 查询

**问题**：公开 API 对每条 post/moment 单独调用 `countApprovedComments` 和 `getContentMetrics`。

**已实施**：`/api/v1/posts`、`/api/v1/moments`、`/api/v1/feed`、`/api/v1/search` 全部改用 `countApprovedCommentsBulk` + `getContentMetricsBulk`，先收集当页 ids 再批量查询。

---

### ⏭️ P0-3 全站 `no-store` 缓存策略优化

**已决策（2026-08-05）：维持现状，不做改动。** 方案 A 即为现状——`/_next/static` 与 `/uploads` 已单独长缓存（`next.config.ts` 覆盖规则正确），HTML `no-store` 是有意为之（微信内置浏览器即时更新），非管理员重复访问冷渲染的成本对个人博客可接受。方案 B（ISR/数据缓存 + revalidatePath 精确失效）不实施。

---

## 🟡 P1 — 中优先级

### ✅ P1-4 Markdown 输出端加白名单 sanitize（兜底）

**已实施**：引入 `sanitize-html`（^2.17.6 + @types/sanitize-html dev 依赖），`renderMarkdown`（`src/lib/markdown.ts`）输出端过白名单净化。白名单保留 TOC `id`、`blog-music` 容器的 `data-server/data-id/data-type`、代码块 `class`。已验证：`<script>`/`onclick`/`javascript:` 均被清除，音乐容器与目录锚点正常存活，文章详情页渲染通过。

---

### ✅ P1-5 无索引的内存过滤标注

**已实施**（短期方案）：`src/lib/db.ts` 的 `listPostsByTag`/`listPostsByCategory` 及 `search/route.ts` 增加注释，标注"数据量 > 约 500 篇后应重构：FTS5 全文搜索，或拆为 `post_tags(post_id, tag)` 关系表 + 索引"。长期重构未做。

---

### ✅ P1-6 sessions / login_attempts 表定期清理

**已实施**：`createDb` 启动逻辑统一执行：
- `DELETE FROM sessions WHERE expires_at < now`
- `DELETE FROM login_attempts WHERE first_failed_at < now - 24h`

**顺带修复**：`login_attempts` 存储键改为 sha256 哈希（`hashIp`，与 comments 一致），不再明文留存客户端 IP；`getLoginAttempt`/`recordLoginFailure`/`clearLoginAttempt` 读写一致。

---

## 🟢 P2 — 低优先级

### ✅ P2-7 移动端/桌面端 feed 重复渲染

**已实施**（评估结论）：`src/app/(site)/archives/page.tsx` 增加注释说明双渲染取舍——移动端（`MobileFeed`）与桌面列表各渲染一份、moment 的 CommentSection 会被 SSR 两次，对个人博客数据量可接受，维持现状。若未来优化再合并为单一响应式组件。

### ✅ P2-8 上传接口图片"像素炸弹"防护

**已实施**：`src/app/api/admin/upload/route.ts` 对**所有图片类型（含勾选"原图"分支）**用 `sharp().metadata()` 按头信息校验分辨率上限（60MP），超限返回 400；无法读取头信息的交给原压缩/落盘逻辑，不强拦。

### ✅ P2-9 小的健壮性改进

**已实施**：
- 9a：`README.md` 补充直连部署（无 `X-Real-IP`/`X-Forwarded-For`）时来源统一记为 `unknown`、共享限流/点赞去重键的副作用说明。
- 9b：`ensureUniqueCategorySlug` 增加注释——当前分类不可改名（仅创建/删除），未来支持改名需像 `ensureUniqueSlug` 一样传入排除 id。

---

## 验证记录（2026-08-05）

- `npm run lint` ✅ 通过
- `npm run build` ✅ 通过（exit 0；`Custom Cache-Control headers` 警告为原有 `no-store` 配置，非本次改动引入）
- 冒烟测试（standalone server，端口 3070，真实 `data/blog.db`）✅：
  - `/api/v1/posts?page=1&limit=2` → meta `{page:1,limit:2,total:6,total_pages:3}`，每项含 comments_count + metrics
  - `/api/v1/moments?page=2&limit=1` → meta 正确
  - `/api/v1/works?limit=1` → meta 正确
  - `/api/v1/search?q=Next` → 过滤 + bulk 正常
  - `/api/v1/feed?limit=2` → 合并时间流 + bulk 正常
  - `/posts` → SQL 分页正常，标题与 `6 篇` 计数正确
  - `/posts/music-test-…` → sanitize 后 2 个 `blog-music` 容器、TOC `id` 完好，无注入 `<script>`
