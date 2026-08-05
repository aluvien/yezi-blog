# yezi-blog 功能需求清单（交接协作用）

> 状态标记：⬜ 待开发｜🚧 进行中｜✅ 已完成并验收（见文末「验证记录」）
> 本清单描述**要做什么 + 怎么验收**，不替代阅读现有代码。改动前先读对应「涉及文件」。
> 全局约束见文末「通用约定」，所有条目都受其约束（尤其音乐持久化、sanitize 白名单、深色模式）。

---

## 🔴 F1 — 全局持久音乐播放器（悬浮球 + 底部控制面板 + 全局播放列表）✅

**优先级最高，架构级改动。其余音乐相关需求都建立在它之上。**

### 现状（必须先理解）
- `src/components/site/MusicInitializer.tsx` 用 MutationObserver 扫描 `.blog-music` 容器，为每个容器**就地** `new APlayer`（播放器嵌在正文里），容器移除即 `destroy`。
- 播放规格 `MusicSpec = { server, id, type }`，`src/lib/music.ts` 提供 `parseMusicSpec / parseMusicBlock / buildMetingUrl / musicContainerHtml`。
- Meting API 根地址来自站点设置 `meting_api`（`SiteSettingsForm` 已可配），经 `SiteLayoutInner` 传给 `MusicInitializer`。
- 它挂在 `SiteLayoutInner`（`<html>` 内的固定布局层），**客户端导航时不会卸载**。

### 需求
1. **无刷新切换页面、音乐不中断**：点击站内链接（首页/文章/想法/作品/关于等）跳转时，正在播放的音乐继续播放，不重载、不打断。
2. **右下角悬浮音乐图标**：有播放内容时右下角常驻一个悬浮按钮（圆形音符图标），点击在底部展开/收起音乐控制面板。
3. **底部控制面板**：展开后是完整的 APlayer 控制条（播放/暂停、进度、音量、列表、歌词），而非只读的迷你条。
4. **默认播放列表来自后台设置**：站点设置里配置一个默认歌单（`server:id:type` 规格，通常 `type=playlist`），全站加载后作为基础列表。
5. **页面点选的音乐追加到列表末尾并播放**：在文章/想法里点击某条音乐（或其播放按钮）时，把该曲目/歌单**追加**到全局列表最后面，并立即播放它；不覆盖默认列表。

### 实现思路（贴现有代码）
- **持久化前提**：导航无刷新由 Next `<Link>` 客户端路由天然提供（`SiteNav`/移动菜单/正文链接全用 `<Link>`）。要保活，**全局播放器必须挂在与 `MusicInitializer` 同级的布局持久层**（`SiteLayoutInner` 内、`{children}` 之外），不能放进任何页面组件（页面组件每次导航都重建）。
- **改造方向**：新增一个全局单例播放器组件 `GlobalMusicPlayer`（client），替代/包裹现有"每容器一个 APlayer"的模式：
  - 维护一份全局 `audio[]` 列表 state（Context 或模块级事件总线）。
  - 初始列表 = 默认歌单（拉 `meting_api` 取 `MusicSpec` → tracks）。
  - 渲染悬浮按钮 + 底部面板，面板内放一个 APlayer 实例（`listFolded` 可配）。
  - 暴露"追加并播放"方法：`addAndPlay(tracks)` → `player.list.add(tracks)` 后 `player.list.switch(末位)` + `player.play()`（APlayer 提供 `list.add / list.switch` API）。
- **正文 `.blog-music` 容器**改为渲染一个**轻量触发卡片**（封面 + 歌名 + 播放按钮），点击调用全局 `addAndPlay`，不再各自 new APlayer。`MusicInitializer` 的扫描逻辑保留，但职责从"就地初始化播放器"改为"初始化触发卡片并注册到全局列表"。
- **深色模式**：面板继续走 `[data-theme="dark"] .blog-music .aplayer …` 那套覆盖（globals.css 1847+ 行已有完整规则），新增面板容器套用同一组 CSS 变量，确保切主题即时生效。
- **APlayer 体积**：继续 `import("aplayer")` 动态加载，避免阻塞首屏。

### 涉及文件
- 新增 `src/components/site/GlobalMusicPlayer.tsx`（悬浮球 + 面板 + 全局列表）
- 改 `src/components/site/MusicInitializer.tsx`（容器→触发卡片，注册全局）
- 改 `src/lib/music.ts`（如需：追加/去重/播放的工具函数、默认歌单解析）
- 改 `src/components/site/SiteLayoutInner.tsx`（挂载 `GlobalMusicPlayer`，传默认歌单设置）
- 改 `src/components/admin/SiteSettingsForm.tsx` + `src/lib/actions/settings.ts`（新增 `default_music` 设置项）
- 改 `src/app/globals.css`（悬浮球/面板样式 + 深色覆盖）

### 验收方式
- [ ] 文章页点开一条音乐 → 开始播放；点导航切到"想法"再切到"作品"，**播放不中断、进度不回退**。
- [ ] 右下角有悬浮音符按钮；点击展开底部面板，再点收起；面板可切歌、拖动进度、调音量、看列表。
- [ ] 后台设置默认歌单保存后，刷新全站，面板列表默认包含该歌单曲目。
- [ ] 在文章里点另一条音乐 → 该曲追加到面板列表**末尾**并立即播放，默认歌单曲目仍在。
- [ ] 切深/浅色主题，悬浮球与面板配色跟随，无白底残留。
- [ ] 移动端：悬浮球不遮挡正文与评论输入，面板可正常展开操作。
- [ ] 直接刷新页面（F5）音乐停止属预期（无跨会话持久要求），仅要求"站内导航"不中断。

---

## 🔴 F2 — 文章页标签移到正文底部 ✅

### 现状
`src/app/(site)/posts/[slug]/page.tsx` 第 70–82 行：标签渲染在 `<header>` 内（标题/meta 之下、正文之上）。

### 需求
标签不再显示在文章顶部，移到**正文结束之后**的合适位置（建议放在文末分隔 `• • •` 之后、作者卡片之前，或作者卡片之后、相关阅读之前——实现时选一处并在验收里固定）。

### 实现思路
- 把第 70–82 行的标签块整体从 `<header>` 移到正文 `article-body` 之后。样式类沿用（`rounded-full bg-accent/10 …`）。
- 注意 `<ArticleImageWrapper>` 包裹的是封面+正文，标签放它外面即可。

### 涉及文件
- 改 `src/app/(site)/posts/[slug]/page.tsx`

### 验收方式
- [ ] 打开任意带标签文章：标题/meta 区域**无**标签；正文底部出现相同标签 chips，可点击跳 `/tags/<tag>`。
- [ ] 无标签文章不出现空容器。
- [ ] 深浅色下标签配色正常。

---

## 🟡 F3 — 深色切换按钮：移动端隐藏、桌面端放在搜索图标右边 ✅

### 现状
`SiteLayoutInner.tsx` 第 62–77 行的主题切换按钮，当前在导航 `<nav>` **之前**渲染（顺序：主题按钮 → 桌面导航 → `SiteSearch` → 移动汉堡）。移动端也显示。

### 需求
- 移动端（`<md`）**不显示**深色切换图标。
- 桌面端把该图标放到**搜索图标右边**（即 `SiteSearch` 之后）。

### 实现思路
- 将主题按钮 JSX 移到 `<SiteSearch />` 之后。
- 给按钮容器加 `hidden md:flex`（项目断点：桌面导航用 `md:flex`，侧栏用 `min-[820px]`，统一用 `md` 即可），移动端彻底不渲染。
- 图标显隐逻辑（`[html[data-theme='dark']_&]` 双图标方案）保持不变。

### 涉及文件
- 改 `src/components/site/SiteLayoutInner.tsx`

### 验收方式
- [ ] 桌面端：搜索图标右侧紧邻主题切换按钮，顺序为「导航 → 搜索 → 主题」。
- [ ] 移动端（宽度 < 768px）：顶部**没有**主题切换图标，其余（Logo/搜索/汉堡）正常。
- [ ] 点击切换深/浅色仍正常，水合无闪烁。

---

## 🟡 F4 — 想法之间的分隔线弱化/替换 ✅（已选方案 A：纯留白）

### 现状
`src/app/(site)/moments/page.tsx` 第 36 行用 `divide-y divide-divider` 在想法之间画实线分隔。用户反馈"太突兀"。

### 需求
去掉生硬的横线，换成更柔和、不影响美观又能表达条目边界的方式。

### 候选方案（任选其一，实现时定一种并写进验收）
- **A. 纯留白**：删 `divide-y divide-divider`，仅靠 `py-7 md:py-8` 的垂直间距分隔（最简，推荐先试）。
- **B. 柔和分隔点**：把实线换成居中、低对比的短分隔符（如 `· · ·` 或一小段渐变线），文字色用 `text-faint`/`--divider`。
- **C. 时间轴左侧竖线**：保留左缘一条细竖线串联各条（朋友圈/时间轴感），条目间无线。

### 涉及文件
- 改 `src/app/(site)/moments/page.tsx`（容器类）
- 可能改 `src/app/globals.css`（`.moment-entry` 分隔样式，若选 B/C）
- 注意：首页 `MobileFeed` 与归档页也用 `MomentEntry`，确认是否同步弱化（默认只改 `/moments` 页，其他页按需）。

### 验收方式
- [ ] `/moments` 页想法之间**不再有贯穿实线**。
- [ ] 条目边界仍清晰可辨（留白或柔和新分隔），深浅色下均不突兀。
- [ ] 首页/归档页如约定同步修改，则一并检查。

---

## 🟡 F5 — 登录后想法右上角就地编辑 ✅

### 现状
- 想法页已能判定登录：`moments/page.tsx` 第 22 行 `const isAuthorized = !!(await getSession())`，并传给 `MomentWriter`。
- 已有前台写想法能力：`MomentWriter` + `MomentForm compact`（`src/components/admin/MomentForm.tsx`），提交走 `createMomentAction / updateMomentAction`（`src/lib/actions/moments.ts`，内部 `requireAdmin`）。
- 想法条目 `MomentEntry` 目前**没有**编辑入口。

### 需求
管理员已登录时，鼠标悬停 / 触屏点触到某条想法，就在该想法**右上角**显示一个"编辑"小按钮；点击后以与"写想法"一致的内联表单就地编辑该条内容，保存即更新。

### 实现思路
- **登录判定**：`moments/page.tsx` 已有 `isAuthorized`，继续透传到每条 `MomentEntry`（新增 prop，如 `canEdit`）。
- **编辑按钮**：在 `MomentEntry` 头部右上角（`moment-entry-head` 区域）加一个按钮，仅 `canEdit` 时渲染；默认 `opacity-0`，`.moment-entry:hover` / `:focus-within` 时显示；移动端触屏无 hover，约定**点触条目**或常显一个低透明度小图标（实现时定，建议移动端常显 `opacity-40`）。
- **就地编辑**：点击后把该条内容区切换为 `MomentForm compact`（传 `moment`，复用现有编辑态，`onSuccess` 后 `router.refresh()`）。可新增一个 client 包装组件（如 `MomentEditable`）管理"查看态/编辑态"切换，服务端 `MomentEntry` 保持不变或仅注入编辑按钮插槽。
- **权限安全**：前端只控显隐，真正写入仍由 `updateMomentAction` 的 `requireAdmin` 兜底（已具备）。

### 涉及文件
- 改 `src/app/(site)/moments/page.tsx`（透传 `isAuthorized`）
- 改 `src/components/site/MomentEntry.tsx`（编辑按钮 + 插槽）
- 新增/复用 client 组件承载编辑态（复用 `MomentForm compact`）
- 改 `src/app/globals.css`（编辑按钮 hover/触屏显隐）

### 验收方式
- [ ] 未登录访客：想法上**看不到**任何编辑按钮。
- [ ] 已登录管理员：悬停（桌面）/点触（移动）想法，右上角出现编辑按钮；点击切换到与"写想法"一致的编辑表单，预填原文与图片。
- [ ] 修改保存后内容更新、页面刷新到位；取消则还原为查看态。
- [ ] 未登录时直接调 `updateMomentAction` 仍被拒（401/跳转），前端显隐不构成越权。

---

## 🟡 F6 — 登录后评论区就地以 UP 主身份回复 ✅（单条回复模型）

### 现状
- 评论渲染：`src/components/site/Comments.tsx`（client）。已支持 `admin_reply` 嵌套展示（第 171–185 行，`comment-children` + `comment-item-reply`），并给 `nickname === site.author` 的评论打"作者"徽标（`comment-author-badge`）。
- 回复动作：`replyCommentAction(id, reply)`（`src/lib/actions/comments.ts` 第 47 行）已存在，内部 `requireAdmin`，写 `admin_reply` + `replied_at`。
- 服务端包装 `CommentSection.tsx` 取已审核评论传给 `Comments`。**目前没有传登录态。**

### 需求
管理员已登录时，可在前台评论区**直接回复**已有评论，无需进后台：
1. 鼠标悬停 / 触屏点触到某条评论区域，显示"回复"按钮；否则不显示。
2. 回复以 UP 主身份提交，前端标注"UP 主"身份徽标以区别于普通评论。
3. 回复内容**嵌套**在该评论下方（沿用现有 `admin_reply` 嵌套样式）。

### 实现思路
- **登录判定**：`CommentSection`（Server Component）里 `await getSession()`，把 `isAdmin` 传给 `Comments`。
- **回复按钮**：每条评论加"回复"按钮，仅 `isAdmin` 渲染；默认隐藏，`.comment-item:hover` / `:focus-within` 显示；移动端约定点触评论显示或常显低透明度（同 F5 的约定，保持一致）。
- **就地回复框**：点"回复"在该评论下方展开一个小输入框，提交调 `replyCommentAction(id, text)`，成功后 `router.refresh()`。
- **UP 主标注**：回复块（`comment-item-reply`）的作者名旁徽标文案改为/新增 **"UP 主"**（当前是"作者"，按需求改为 UP 主；普通作者评论仍保留原徽标规则）。
- **数据模型**：沿用单条 `admin_reply`（一条评论一个 UP 主回复）。**若要多条回复/多层嵌套，需改 `comments` 表结构（新增 parent_id 或独立回复表），属更大改动——本清单默认维持单回复模型，嵌套样式已满足"嵌套处理"。** 实现前先与需求方确认单条 UP 主回复是否够用。
- **权限安全**：显隐仅前端，`replyCommentAction` 的 `requireAdmin` 兜底（已具备）。

### 涉及文件
- 改 `src/components/site/CommentSection.tsx`（取 session、传 `isAdmin`）
- 改 `src/components/site/Comments.tsx`（回复按钮 + 就地回复框 + UP 主徽标）
- 复用 `src/lib/actions/comments.ts` 的 `replyCommentAction`
- 改 `src/app/globals.css`（回复按钮显隐、回复框、UP 主徽标样式）

### 验收方式
- [ ] 未登录：评论上无"回复"按钮。
- [ ] 已登录：悬停/点触评论显示"回复"；点击展开输入框，提交后该评论下方**嵌套**出现回复，带 **UP 主** 徽标与 `replied_at` 时间。
- [ ] 回复作者显示为站点作者名 + UP 主徽标，与普通评论视觉上可区分。
- [ ] 页面刷新后回复仍在（已写库），嵌套层级正确。
- [ ] 未登录直接调 `replyCommentAction` 被拒。

---

## 通用约定（所有条目遵守）

1. **音乐持久化只针对站内客户端导航**：靠 `<Link>` + 布局持久层实现；整页刷新（F5）或新开标签页音乐停止是可接受的，不要求跨会话记忆播放进度。
2. **sanitize 白名单**：`renderMarkdown` 输出经 `sanitize-html` 白名单（`src/lib/markdown.ts`）。F1 若给正文音乐容器加新属性（如封面/按钮 data-*），**必须把对应标签/属性加进 `SANITIZE_OPTIONS.allowedTags / allowedAttributes`**，否则会被剥掉。
3. **深色模式**：所有新增 UI（悬浮球、面板、编辑/回复按钮、徽标）都要在 `[data-theme="dark"]` 下验证，优先复用 `--soft/--paper/--foreground/--muted/--accent` 等 CSS 变量，避免硬编码颜色。
4. **登录态只在服务端判定**：`getSession()` 只能在 Server Component 调用，结果以 prop 传给 client 组件（参考 `moments/page.tsx` 现有 `isAuthorized` 模式）。客户端显隐不等于权限，所有写操作必须保留服务端 `requireAdmin`。
5. **不破坏现有优化**：保持 P0-1 分页、P0-2 bulk 查询的成果；新增查询避免引入 N+1。
6. **触控与悬停统一约定**：本项目"悬停显示"类按钮（F5 编辑、F6 回复）在移动端无 hover，统一采用「桌面 hover 显示、移动端点触目标显示或常显低透明度」的同一套交互，保证一致性。

---

## 建议实施顺序

| 阶段 | 条目 | 说明 |
|---|---|---|
| 1 | F1 全局音乐播放器 | 架构级，先行；其他 UI 项可并行 |
| 2 | F2 标签移位 / F3 主题按钮 / F4 分隔弱化 | 纯前端小改，可一次性做完 |
| 3 | F5 想法就地编辑 | 依赖登录态透传，中等 |
| 4 | F6 评论就地回复 | 依赖登录态透传 + 回复框，中等；先确认单回复模型是否够用 |

> 每项完成后更新上方状态标记，并在「验证记录」补一行日期 + 结果。

---

## 验证记录（2026-08-05）

- `npm run lint` ✅ 通过；`npm run build` ✅ 通过（exit 0）。
- standalone 冒烟（临时端口 3040，真实 data/blog.db）✅：
  - `/` 首页 HTML 含 `global-player-panel` / `aplayer-host`（全局播放器常驻布局层）；无曲目时悬浮球不渲染。
  - `/posts/music-test-…` 含 2 个 `.blog-music` 容器（SSR 为空，卡片由客户端 MusicInitializer 填充）；触发卡片与 `requestGlobalPlay` 逻辑已确认打进客户端 chunk。
  - `/moments` 无 `divide-y divide-divider` 残留；未登录无 `moment-edit-btn`。
  - `/posts/meaning` 标签链接出现在 `• • •` 分隔与正文之后（不再在 header）。
  - 主题按钮 class 为 `hidden … md:flex`，且在搜索图标之后。
- 登录态冒烟（临时测试库 /tmp/blog-test.db + 已知密码，端口 3041）✅：
  - `/api/admin/login` 200；带 cookie 取 `/posts/welcome`：3 个 `comment-reply-btn`、1 个 `UP主` 徽标、嵌套回复 `comment-children` 与管理员回复文案均渲染；匿名对照为 0。
  - 带 cookie 取 `/moments`：4 个 `moment-edit-btn`（每条想法一个）；匿名对照为 0。
- 需要真实浏览器确认（无自动化工具）：F1 音乐实际播放、站内导航不断播、悬浮球动画、面板深浅色；F5/F6 触屏上的按钮显隐手感。代码与 SSR/构建层面已验证。
