# yezi-blog 审计整改清单（模型交接用）

> 审计日期：2026-08-25
> 审计基线：`main@9695976`（审计时与 `origin/main` 一致，工作树干净）
> 当前状态：整改代码已完成本地实施与分级验证；涉及真实 PM2/Nginx、防火墙、QQ sidecar、异机备份和灾备恢复的项目仍须在用户授权的生产环境验收。状态与验证记录见下文。
> 用途：交给其他模型或开发者逐项实施。每完成一项，应更新状态并在文末补充验证记录。

## 状态标记

- ⬜ 待处理
- 🚧 处理中
- ✅ 已完成且满足本项全部验收要求
- ⛔ 阻塞；必须在条目下记录阻塞原因和需要的决策
- 🟨 接受风险；必须记录接受人、日期、适用环境和复审日期

## 审计结论摘要

- 未发现直接的 SQL 注入、任意文件读取、认证绕过、远程代码执行或 Markdown 直接 XSS。
- 发现两项最高优先级问题：公开 QQ 音乐接口的上游请求放大，以及在线目录原地构建导致的部署资源错配。
- 之前审计提出的 nonce CSP、搜索全表扫描、敏感文件权限、密码长度时序、过期会话清理等问题已经基本修复；实现后必须通过文末的回归清单，不能把这些保护改坏。

## 条目索引

| ID | 状态 | 主题 |
| --- | --- | --- |
| P0-1 | 🟨 | 公开 QQ 音乐接口的上游请求放大与站主会话滥用 |
| P0-2 | 🟨 | 在线目录原地构建、浏览器触发重启与无回滚部署 |
| P1-1 | ✅ | 登录跨站请求污染 IP 锁定状态 |
| P1-2 | ✅ | Cookie 管理 API 缺少统一 CSRF 边界 |
| P1-3 | 🟨 | 远程抓取超时不覆盖响应体 |
| P1-4 | 🟨 | Next Proxy 10MB 与应用 20MB 上传上限冲突 |
| P1-5 | 🟨 | PM2 公网监听与 TRUST_PROXY 信任边界冲突 |
| P1-6 | ✅ | 公开 feed 全量加载后分页 |
| P1-7 | 🟨 | 备份不完整、同故障域且文档路径过期 |
| P1-8 | 🟨 | 未来数据库 schema 没有拒绝保护 |
| P2-1 | ✅ | QQ 元数据进入 APlayer innerHTML |
| P2-2 | ✅ | 匿名写接口接受跨站简单请求 |
| P2-3 | ✅ | 修改管理员密码不撤销旧会话 |
| P2-4 | ✅ | 临时认证和互动数据没有统一周期清理 |
| P2-5 | ✅ | 备份同名竞态及遗留 WAL/SHM |
| P2-6 | ✅ | 裁切附件 DB 失败后遗留孤儿文件 |
| P2-7 | ✅ | b23.tv 短链伪支持 |
| P2-8 | 🟨 | CI 缺少部署状态机和关键边界回归 |

## 审计时验证基线

以下结果用于后续对比，不等于整改后的验收结果：

- `npm audit --json`：0 个已知漏洞。
- `npm run check`：通过。
- `npm test`：89/89 通过。
- `npm run test:e2e`：12/12 通过。
- `npm run build`：通过。
- `npm run test:production`：standalone、SQLite、FTS、CSP 冒烟通过。
- 覆盖率：lines 80.03%，branches 75.95%，functions 74.43%。
- 真实数据库只读检查：`integrity_check=ok`、schema v7、posts/FTS 行数一致。

## 给接手模型的执行约束

1. 开始前先读根目录 `AGENTS.md`；涉及 Next.js 行为时，先读 `node_modules/next/dist/docs/` 中当前 16.3.1 版本对应文档，不按旧版 Next.js 经验猜测。
2. 一次只处理一个条目或一个明确耦合的小组，保留用户已有改动，不使用 `git reset --hard`、`git clean` 等破坏性命令。
3. 所有测试使用临时 `BLOG_ROOT`/`BLOG_DB_PATH`；不得修改、迁移、清空或用测试数据污染真实 `data/blog.db`。
4. 安全边界必须放在服务端。前端隐藏按钮、CORS 响应头、客户端 visitor ID 都不能当作授权或可靠限流。
5. 修复必须包含针对该问题的自动化回归测试；仅依靠全局覆盖率数字或手工点击不能标记完成。
6. 修改部署代码时不得在开发机或生产机实际执行同步、PM2 重启、软链切换或远端发布，除非用户另行明确授权。
7. 每项完成后运行该条目的专项测试，再运行文末“整体验收”；在验证记录中写清命令、结果、提交号和任何偏离方案的决定。

## 实施前需要确认的决策点

以下选择会实质改变接口或运维方式。接手模型应先从现有上下文确认；无法确认时向用户询问，不得自行扩张范围：

| 条目 | 需要确认 | 推荐默认 |
| --- | --- | --- |
| P0-1 | 公共音乐授权采用“已发布内容允许集合”还是 HMAC 令牌；公开歌单最多多少首 | 缓存的已发布允许集合 + 20 首 + single-flight |
| P0-2/P1-8 | release 根目录、稳定状态目录、外部环境文件、保留数量、健康检查 URL、PM2 固定名称，以及 schema 变化后的数据库回滚方式 | 版本化 release + 独立 `BLOG_ROOT`/`BLOG_DB_PATH` + 外部 `0600` 环境文件 + 至少保留当前/上一版；schema 变化时先建立已验证快照，并在切换验收完成前阻止写入 |
| P1-2 | 原生管理 API 改 Bearer Token，还是继续 Cookie 并增加无 Origin 的附加证明 | 独立可撤销 Bearer Token |
| P1-4 | 提高 Proxy 缓冲上限，还是从 Proxy 排除上传并依赖回环 Nginx/流式解析 | 文件 20 MiB、应用请求 21 MiB、Proxy/Nginx 22 MiB；公开生产入口由 Nginx 对超限请求返回 413，Node 只监听回环 |
| P1-7 | 异机备份目标、加密方案、保留期与恢复责任人 | 必须由用户选择目标并提供授权；不得自行上传任何 `data/` |
| P2-3 | 环境变量改密如何触发全会话撤销 | 持久化 session generation + “撤销全部会话”命令；改密运行手册要求同一维护操作内改密码、递增 generation、重启并验证 |
| P2-7 | 是否真的支持 b23.tv | 管理员插入阶段安全展开；公开渲染阶段不联网 |

---

## 🔴 P0 — 立即处理

### 🟨 P0-1 公开 QQ 音乐接口可形成约 1→101 的上游请求放大

**类别**：安全 / 可用性 / 第三方账号滥用

**问题与证据**：

- `src/app/api/music/qq/route.ts:266-310` 无需认证，接受任意歌曲或歌单 ID。
- `src/app/api/music/qq/route.ts:189-263` 单个歌单最多解析 100 首；缓存未命中时先取一次歌单，再逐首获取播放地址，最多约 101 次 sidecar 请求。
- 相同 `(type,id)` 的并发缓存未命中没有 in-flight Promise/single-flight，所有请求都会各自展开。
- `src/lib/qq-music-api.ts:41-50` 会向本地 sidecar 附带站主 QQ 会话。
- `src/app/api/music/qq/route.ts:267` 使用 `getVisitorKey()` 限流；`src/lib/request.ts:68-75` 允许客户端自报 `x-yezi-visitor-id`，轮换 UUID 即可获得新桶，不传该头时也可轮换 User-Agent。

**触发与影响**：匿名攻击者可并发请求任意有效歌单，拖垮 Node/sidecar、触发 QQ 上游限流或账号风控，并借站主会话解析任意歌曲/歌单的播放地址。若知道非公开歌单 ID，还可能枚举站主有权访问的歌单内容。

**处理方式**：

1. 公开接口只允许解析已经出现在已发布文章、公开想法、关于页或默认音乐设置中的 `type:id`。可采用服务端允许集合，或由 SSR 为 `(type,id,expiry)` 生成 HMAC 令牌。
2. 后台登录态可以按业务需要放宽，但必须保留独立的高成本操作限流。
3. 高成本路由的滥用桶使用服务端取得的纯 IP 哈希；不得把 User-Agent 或 `x-yezi-visitor-id` 用作限流身份。
4. 增加全局并发信号量、每 IP 限流、同一 `(type,id)` 的 single-flight、短期失败缓存和整个解析过程的绝对超时。
5. 将公开歌单解析上限降到合理值，建议 20–30 首。歌单解析成功后，只为本次返回的曲目签发短期、限定用途的歌词授权，或把这些曲目加入有严格 TTL 的子授权集合；不能因为歌单本身获准就开放任意 MID。
6. 返回给浏览器的错误必须归一化，不能暴露 sidecar 内部地址、会话、原始上游错误或 Cookie。
7. 允许集合必须有明确的失效机制：文章/想法发布、撤回、编辑、删除，以及关于页或默认音乐修改后立即失效或刷新，不能长期沿用旧授权。

**验收要求**：

- [ ] 任意未发布、未配置且无有效签名的歌曲/歌单 ID 在调用 sidecar 前被拒绝，状态码和错误结构稳定。
- [ ] 已发布文章、公开想法和默认音乐中的合法单曲、歌单、歌词仍能正常播放。
- [ ] 发布、撤回、编辑或删除内容，以及修改关于页/默认音乐后，授权集合在约定时间内同步更新；撤回的 ID 不再可用。
- [ ] 合法歌单返回的每首曲目只获得短期歌词权限；过期、篡改或不属于该歌单的 MID 在调用 sidecar 前被拒绝。
- [ ] 更换 `x-yezi-visitor-id` 或 User-Agent 不会获得新的高成本请求额度。
- [ ] 同时发起至少 10 个相同歌单请求时，mock sidecar 只发生一组解析调用，其余请求复用同一个 in-flight 结果。
- [ ] 单个公开歌单触发的逐首请求数不超过最终约定上限。
- [ ] sidecar 慢响应或部分歌曲超时时，整个接口在约定总时限内结束，不会按“批次数 × 12 秒”无限累积。
- [ ] QQ Cookie、sidecar 地址和原始内部错误不出现在响应、客户端日志或普通应用日志中。
- [ ] 新增自动化测试覆盖：允许集合/签名、任意 ID 拒绝、UUID/UA 绕过失败、并发合并、失败缓存、总超时和上限。

---

### 🟨 P0-2 GitHub 同步在在线目录原地构建，可能再次造成 ChunkLoadError

**类别**：部署可靠性 / 可用性 / 回滚安全

**问题与证据**：

- `src/lib/actions/sync.ts:203-259` 先在在线目录执行备份、`git pull`、可能的 `npm ci` 和 `npm run build`，构建结束后才调用 `findPm2Name()`。
- `scripts/build.mjs:23-36` 直接改写当前项目的 `.next`。
- `src/components/admin/SyncGithubButton.tsx:58-88` 需要浏览器在第一个 Action 成功后再调用第二个重启 Action。
- `scripts/restart-pm2.mjs:23-32` 只要 `pm2 restart` 命令返回就标记成功，没有应用健康检查或回滚。
- 构建期间旧 Next 进程仍提供服务，可能懒加载到新旧混合的 server chunks、manifests、静态资源或 `node_modules`。此前线上出现的 `This page couldn’t load` 和 `ChunkLoadError` 与此失败模式吻合。
- 此前 `pm2 ls` 为空而 3030 仍有 `next-server` 监听，说明旧进程不受当前 PM2 实例管理；这是独立的进程管理/预检缺陷，不作为 ChunkLoadError 的直接证据。

**处理方式**：

1. 改为版本化 release：在独立 worktree/release 目录中拉取指定提交，安装依赖、构建并执行 production smoke。
2. 在任何 pull、依赖安装或构建前完成部署环境和 PM2 管理权预检。未找到目标进程时不得修改当前在线 release。
3. 构建成功后原子切换 `current` 软链，再由服务器侧持久任务重启 PM2；不要依赖浏览器发第二次请求。
4. 部署锁覆盖“准备 → 构建 → 切换 → 重启 → 健康检查 → 成功/回滚”完整生命周期。
5. 健康检查至少验证：首页 200、CSP、build ID、一个真实 JS chunk、SQLite/FTS 可读和预期端口监听。
6. release 目录只放代码与构建产物。将 `BLOG_ROOT`、`BLOG_DB_PATH`、上传/引用归档/状态目录和密钥放到稳定的外部位置；由固定 PM2 环境或受限的外部环境文件显式注入，不依赖每个 worktree 中未跟踪的 `.env.local`。环境文件权限必须为 `0600`，启动前检查必需变量和路径所有权。
7. P1-8 必须与本项同一交付或先完成。凡会提升 schema 的发布，在迁移前创建并验证 SQLite online backup，并明确阻止写入的切换窗口；健康失败时先恢复与旧 release 匹配的数据库快照，再启动旧 release。若改用向后兼容的 expand/contract 迁移，必须有显式兼容版本范围和自动化证明，不能一边拒绝所有未来 schema、一边假定旧 release 可直接启动。
8. 失败时切回上一 release 并重新启动上一版本；稳定状态目录不随 release 清理。

**验收要求**：

- [ ] PM2 不存在、名称不匹配或环境预检失败时，在任何 Git/`.next`/`node_modules` 变更前失败。
- [ ] 新 release 不包含或复制真实 `.env.local`；它从固定的外部来源取得配置，并实际使用约定的 `BLOG_ROOT`、`BLOG_DB_PATH`、上传/引用目录和密钥。缺少变量、权限过宽或路径不可写时在切换前失败。
- [ ] 构建失败、依赖安装失败或 smoke 失败时，当前在线 release、进程和静态资源完全不变。
- [ ] 部署期间持续访问旧站点不会出现缺失 chunk、混合 build ID、CSS/JS 404 或通用加载错误。
- [ ] 浏览器在收到“已开始部署”后立即关闭，服务器部署任务仍能独立完成或回滚。
- [ ] 重复点击同步在最终健康检查完成前都被同一部署锁拒绝。
- [ ] `pm2 restart` 成功但应用未监听、进入 restart loop 或 chunk 校验失败时，状态不得标记为 success，并会自动回滚。
- [ ] “schema 已升级但新 release 健康检查失败”路径有可重复测试：旧代码不会直接写入未来 schema；选择快照方案时先恢复快照再启动旧 release，选择兼容迁移时由兼容矩阵证明旧 release 可安全读写。
- [ ] 成功部署后 `current` 指向新提交，PM2 只运行预期 release；旧 release 按保留策略清理，但至少保留一个可回滚版本。
- [ ] 自动化测试覆盖：PM2 缺失、Git 拉取失败、`npm ci` 失败、build 失败、并发同步、浏览器未触发第二请求、健康检查失败、回滚成功和最终成功路径。

**临时措施**：在本项完成前，不使用后台“同步 GitHub”按钮；采用明确的维护窗口和人工、可回滚的部署流程。

---

## 🟡 P1 — 中优先级

### ✅ P1-1 登录接口可被跨站请求污染 IP 锁定状态

**类别**：认证可用性 / Login CSRF

**问题与证据**：

- `src/app/api/admin/login/route.ts:7-16` 和 `src/lib/request.ts:15-49` 会解析任意 Content-Type 中的 JSON，不验证 Origin。
- `src/lib/auth.ts:47-52` 在固定时长密码比较前先返回 IP 锁定结果；同一来源 5 次错误后，正确密码也会被拒绝 15 分钟。
- 恶意网页可通过无需 CORS 预检的 `text/plain` POST，借访问者出口 IP 连发错误密码。若 `TRUST_PROXY` 配错导致来源统一为 `unknown`，任意攻击者即可锁定全部管理员。

**处理方式**：

1. 浏览器登录只接受 `Content-Type: application/json`，拒绝不匹配的 Origin/Host 和 `Sec-Fetch-Site: cross-site`。
2. 明确定义无 Origin 的原生客户端策略；不得把浏览器跨站和原生请求混成同一个默认放行分支。
3. 先执行固定长度摘要和 `timingSafeEqual`，只有密码错误时才应用/更新 IP 与账户锁；正确密码可以清理锁并登录。
4. 保留错误密码的 IP 级与账户级保护，不因修复锁定 DoS 而恢复无限猜测。

**验收要求**：

- [ ] 跨站 `text/plain`、跨站 JSON、Origin 与实际 Host 不一致的浏览器登录请求均被拒绝，且不新增 `login_attempts`。
- [ ] 同源 `application/json` 登录正常。
- [ ] IP 已锁定时，正确密码仍能成功并清理相关锁；错误密码继续得到 429 和正确的 `Retry-After`。
- [ ] `TRUST_PROXY=false` 直连和 `TRUST_PROXY=true` 可信反代两种模式均有测试。
- [ ] 原生无 Origin 登录是否允许、使用何种认证已在 `docs/admin-api.md` 中明确记录并有测试。

---

### ✅ P1-2 Cookie 鉴权的管理 REST API 缺少统一 CSRF 边界

**类别**：授权边界 / CSRF

**问题与证据**：

- `src/lib/admin-api.ts:39-75` 只检查 `admin_session`，不接收 Request，因此无法统一校验来源和 Content-Type。
- `SameSite=Lax` 阻止跨站 POST，但不阻止同一 eTLD+1 下的跨源请求。若 `www.yezi.me` 等兄弟域被接管，`text/plain` 简单请求仍可携带目标主机 Cookie 执行副作用。
- 部署同步、重启、创建文章、批量删除和附件清理等敏感路由均依赖该 Cookie 边界。
- `next.config.ts:23-29` 还为 Server Actions 硬编码了多个 allowed origins，需要收敛到实际部署需要。

**处理方式**：

1. 为所有非安全方法建立统一入口，例如 `authorizeAdminApi(request)`：鉴权、Origin 与实际可信 Host/Proto 完全匹配、Content-Type 校验、CSRF 校验一次完成。
2. Web 管理端使用不可被简单请求伪造的自定义 CSRF 头或 token。
3. 原生管理 API 优先改为独立、可撤销、可轮换的 Bearer Token；若仍用 Cookie，必须明确无 Origin 请求的附加认证要求。
4. 删除不必要的 `serverActions.allowedOrigins`，或从单一部署配置生成最小允许集合。

**验收要求**：

- [ ] 对每个 POST/PATCH/PUT/DELETE 管理端点，来自兄弟域、任意外域、`Origin: null` 和 `text/plain` 的 Cookie 请求均不能产生副作用。
- [ ] 同源后台 UI 的所有保存、删除、上传、部署操作正常。
- [ ] 未携带 CSRF 证明的请求返回稳定的 403/415，不重定向到 HTML。
- [ ] 原生客户端可以使用最终选定且文档化的认证方案完成预期操作；若使用令牌，令牌可撤销且不写入日志。
- [ ] 自动化测试至少枚举全部管理写路由，验证未认证、错误 Origin、错误 Content-Type、缺少 CSRF 和正常请求。

---

### 🟨 P1-3 远程网页/图片抓取超时不覆盖响应体

**类别**：SSRF 纵深防御 / 资源耗尽

**问题与证据**：

- `src/lib/remote-fetch.ts:65-114` 已支持在 Abort 时销毁响应流。
- 但 `src/lib/article-reference-server.ts:103-134`、`src/app/api/article-references/image/route.ts:87-114`、`src/lib/article-reference-archive.ts:529-553` 在收到响应头后立即清除 timer，随后才读取最多 8MB 的 body。
- 远端可快速返回响应头，再长期慢速滴送小 body；字节上限不能限制耗时。重定向 body 也没有主动取消。

**处理方式**：

1. 将状态判断、重定向 body `cancel()`、最终 body 读取全部放在同一个绝对 deadline 内。
2. 最好由 `safeRemoteFetch` 提供覆盖 DNS、连接、响应头和完整流生命周期的统一 deadline，调用方只消费受限流。
3. 每次重定向都继续执行现有逐跳 URL 检查和 socket DNS 绑定，不得为修复超时而退回普通 `fetch`。
4. 超时或超限时主动取消 reader、销毁 socket，并返回归一化错误。

**验收要求**：

- [ ] mock 服务在 1 秒内返回响应头、随后每隔数秒滴送一个字节时，调用在约定 deadline 附近终止。
- [ ] 3xx 响应的 body 会在跳转前主动取消，不残留 socket/reader。
- [ ] 正常 HTML、正常图片、合法重定向和 X/FxTwitter JSON 继续工作。
- [ ] 私网、loopback、混合 DNS、DNS rebinding 和逐跳跳向私网仍被现有测试拒绝。
- [ ] 超时测试结束后进程没有悬挂句柄，测试套件能自然退出。

---

### 🟨 P1-4 Next Proxy 10MB 默认上限与 20MB 上传承诺冲突

**类别**：功能可靠性 / 内存边界

**问题与证据**：

- `src/proxy.ts:79-82` matcher 覆盖 `/api/admin/upload` 和 `/api/moments/upload`。
- `next.config.ts:23-30` 未配置 `experimental.proxyClientMaxBodySize`。
- 当前 Next 16.3.1 本地文档 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md` 说明 Proxy 默认只缓冲 10MB，超限后把截断 body 交给路由，而不是自动返回 413。
- `src/app/api/admin/upload/route.ts:28-51` 却允许约 21MB multipart 和 20MB 文件；`deploy/nginx.conf.example:9-10` 的 `20m` 也包含 multipart 开销，低于路由承诺。

**处理方式**：

1. 选择并记录一种方案：
   - 简单方案：文件上限固定为 20 MiB，Route Handler 的 multipart 请求上限为 21 MiB，`experimental.proxyClientMaxBodySize` 与 Nginx `client_max_body_size` 均为 22 MiB。1 MiB 用于 multipart 开销，基础设施再预留 1 MiB；Proxy 会为每个请求额外缓冲。
   - 节省内存方案：从 Proxy matcher 排除两个上传接口，让 Route Handler 自行鉴权；同时必须依靠只监听回环的 Node、可信 Nginx body 上限或真正的流式 multipart 解析处理无 Content-Length 请求。
2. 应用、Next Proxy、Nginx 和 UI 的上限使用同一约定，错误码统一为 413。
3. Next Proxy 超限时默认只截断而不返回 413，因此“简单方案”仍必须让受支持的生产入口先由 Nginx 拒绝超限请求；不能把 Proxy 截断误当成完整的拒绝机制。

**验收要求**：

- [ ] 通过 production standalone 而不是仅调用 Route Handler，上传 11MB 和接近 20MB 的合法文件均成功。
- [ ] `/api/admin/upload` 与 `/api/moments/upload` 两个入口行为一致且都要求有效管理员会话。
- [ ] 经过受支持的生产链路（含 Nginx）时，超过 22 MiB 的 Content-Length 和 chunked 请求都在有限内存下返回 413，不进入完整 `formData()` 缓冲；21–22 MiB 请求由应用按 21 MiB 请求上限返回 413。
- [ ] Node 端口只监听回环；若测试直接绕过 Nginx，超限请求也必须在 22 MiB 左右的已记录内存边界内失败。由于 Next 截断可能表现为 400，这一路径不承诺稳定 413，但不能成为公开可达入口。若产品要求绕过 Nginx 也稳定返回 413，必须改用受限流式解析或显式截断识别。
- [ ] Nginx 示例、README 和应用错误文案使用一致上限。
- [ ] 新增生产上传测试覆盖 11MB、接近上限、超过上限、无 Content-Length 和未认证请求。

---

### 🟨 P1-5 PM2 默认监听公网地址，与 `TRUST_PROXY=true` 信任边界冲突

**类别**：网络边界 / 限流绕过

**问题与证据**：

- `scripts/start-standalone.mjs:38-40` 和 `ecosystem.config.js:16-20` 默认监听 `0.0.0.0:3030`。
- `src/lib/request.ts:56-62` 在 `TRUST_PROXY=true` 时无条件信任请求中的 `X-Real-IP`/`X-Forwarded-For`。
- 若防火墙或面板把 3030 暴露公网，攻击者可绕过 Nginx 直连并伪造 IP，绕过搜索、评论、互动和登录保护。

**处理方式**：

1. PM2/裸机默认绑定 `127.0.0.1`；容器内部需要对外监听时显式覆盖为 `0.0.0.0`，Docker 继续只把宿主端口映射到回环。
2. Nginx 覆盖 `X-Real-IP`，并确保应用只接受可信代理传入的转发头。
3. 文档同时要求操作系统防火墙/安全组阻断公网 3030。

**验收要求**：

- [ ] 默认 PM2 配置启动后，`ss -ltnp` 只显示 `127.0.0.1:3030`，而不是 `0.0.0.0:3030`。
- [ ] 经 Nginx 请求时取得真实客户端地址；客户端伪造的入站 `X-Real-IP` 不会覆盖 Nginx 写入值。
- [ ] 公网或非可信网卡无法直连 3030。
- [ ] Docker 部署仍能在容器内部启动并通过宿主回环端口健康检查。
- [ ] README 明确写出 PM2、Docker、直连三种模式对应的 HOSTNAME/TRUST_PROXY 配置。

---

### ✅ P1-6 公开 `/api/v1/feed` 每次分页仍读取全部正文和想法

**类别**：公开 API 性能 / 匿名 DoS

**问题与证据**：

- `src/app/api/v1/feed/route.ts:7-36` 调用无分页的 `listPosts()` 和 `listMoments()`，批量读取全部正文、评论统计和 metrics，排序后才 `slice`。
- 响应为 `no-store`，匿名重复请求无法利用缓存；任意高页码仍触发相同全量工作。

**处理方式**：

1. 用 SQL `UNION ALL` 只合并 `{type,id,created_at}` 并在 SQL 层分页，然后只 hydrate 当前页 ID。
2. 优先使用游标分页；若保留 page/offset，限制最大 page/offset。
3. 评论数和 metrics 只批量查询当前页 ID，保持现有避免 N+1 的成果。
4. 视公开 API 使用场景增加轻量限流和性能基准。

**验收要求**：

- [ ] 第 1 页、第 2 页和同时间戳边界没有重复或漏项，顺序与现有语义一致。
- [ ] 查询计划或测试证明每次只加载当前页正文，不再读取所有 post/moment content。
- [ ] 任意高页码不会做全量 hydrate，超出最大范围时返回可预测结果或 400。
- [ ] 评论数、metrics、总数和公开序列化字段保持正确，无 N+1。
- [ ] 新增至少千级数据的性能测试，并为 `/api/v1/feed` 增加专项路由测试。

---

### 🟨 P1-7 自动备份不覆盖完整数据，且与原数据位于同一故障域

**类别**：灾难恢复 / 数据安全 / 文档准确性

**问题与证据**：

- `src/lib/backup.ts:25-65` 只备份 SQLite，并写回项目 `data/backups`。
- `docker-compose.yml:18-20` 把数据库、上传、引用归档和状态放在同一个 volume；磁盘或 volume 损坏会同时丢失原数据和 DB 备份。
- `data/uploads`、引用归档/图片、QQ/Telegram 本地状态不在自动备份内。
- `README.md:293-298` 仍写上传目录为 `public/uploads`，`README.md:330-335` 仍要求设置已经被 `src/lib/uploads.ts:39-42` 忽略的 `UPLOAD_DIR`，照文档操作会漏备份。

**处理方式**：

1. 保留 SQLite online backup 作为一致性 DB 快照。
2. 归档时不得直接复制正在写入的 `blog.db`、`blog.db-wal`、`blog.db-shm`。先用 SQLite online backup 生成已通过完整性校验的临时快照，再把该快照以明确名称放入归档；从 `data/` 收集其他内容时显式排除在线数据库、sidecar、临时文件和本地备份目录。
3. 加密归档应明确包含 `uploads`、文章引用归档/图片以及恢复业务所需的 QQ/Telegram 状态；对每类密钥/会话单独记录是否恢复、轮换或故意排除。生成归档期间新增/删除文件的一致性策略必须有文档和测试。
4. 增加异机/对象存储传输，明确保留策略、密钥管理和失败告警。任何真实上传、远端删除、凭据配置或恢复演练都属于外部状态变更，必须得到用户对目标和范围的明确授权；自动化测试只能使用本地 fake adapter。
5. 定期在隔离环境执行恢复演练，不能只验证备份文件存在。
6. 修正 README：唯一上传位置是 `data/uploads`，删除 `UPLOAD_DIR` 说明，列出完整恢复顺序。

**验收要求**：

- [ ] 本地 fake adapter/临时目录测试证明归档只含一份经 SQLite online backup 产生的数据库快照，不含在线 `blog.db-wal`/`blog.db-shm`，并完整包含上传、引用归档和约定状态。
- [ ] 在用户明确授权后，删除隔离演练环境的项目目录或模拟 volume，可以只依赖指定异机备份恢复 DB、上传、引用归档和必要状态；不得以删除真实生产目录作为验收手段。
- [ ] 备份传输和存储均加密，凭据不进入 Git、日志或备份清单输出。
- [ ] 本地测试验证上传失败、远端保留策略和告警；真实远端旧版本删除只有在用户批准保留期和目标后才能执行。
- [ ] 用户授权的隔离恢复演练后运行 `PRAGMA integrity_check`、`foreign_key_check`，并抽查文章图片、引用 reader、QQ/Telegram 配置行为。
- [ ] README 中不再出现 `public/uploads` 或要求配置 `UPLOAD_DIR` 的错误说明。

---

### 🟨 P1-8 数据库缺少未来 schema 版本保护

**类别**：数据兼容 / 回滚安全

**问题与证据**：

- `src/lib/db/migrations.ts:143-176` 在数据库 `user_version` 高于当前 `LATEST_DB_SCHEMA_VERSION` 时不会报错，只是没有迁移可执行，然后继续运行旧 DAO。
- 代码回滚后，旧版本可能在语义不兼容的新 schema 上延迟报错或写入错误数据。

**处理方式**：

1. 启动时若 `user_version > LATEST_DB_SCHEMA_VERSION`，立即拒绝以可写模式启动，错误包含数据库版本和代码支持版本。
2. build readonly 模式可以只读检查，但不得修改未来 schema；是否允许构建应明确并测试。
3. 与 P0-2 同时设计 schema 兼容检查和回滚状态机。默认方案是：迁移前建立已验证快照、切换期间阻止业务写入，健康检查失败时恢复对应快照后再启动旧 release。
4. 如果选择不恢复数据库的 expand/contract 方案，就不能只用单个 `LATEST_DB_SCHEMA_VERSION` 推断兼容性；必须声明每个 release 的最小/最大可读写版本，并证明上一 release 对新 schema 仍安全。

**验收要求**：

- [ ] 临时数据库的 `user_version` 设置为当前版本 +1 时，生产服务在任何业务写入前明确失败。
- [ ] 当前版本和旧版本数据库仍按既有 migration 正常升级。
- [ ] build readonly 不迁移、不清理真实数据库，并对未来 schema 给出明确、不会误写的行为。
- [ ] 部署测试覆盖“新代码迁移成功后健康检查失败”的完整回滚：快照方案验证写入门禁、数据库恢复、旧 release 启动顺序；兼容迁移方案验证显式兼容矩阵。不能盲目启动不兼容旧代码。

---

## 🟢 P2 — 低优先级与纵深防御

### ✅ P2-1 QQ 上游元数据进入 APlayer `innerHTML`

**问题**：`src/app/api/music/qq/route.ts:59-87` 读取的 name/artist 未做纯文本约束；`src/lib/music.ts:188-219` 传给 APlayer。安装的 `aplayer@1.10.1` 在切歌时把歌名、歌手赋给 `innerHTML`。生产 nonce CSP 会阻止常见内联脚本，但 `style-src 'unsafe-inline'` 仍允许 HTML/CSS UI 注入。

**处理方式**：补丁化/替换 APlayer 的两个 sink 为 `textContent`，并在服务端限制文本长度、去除控制字符；URL 字段限制为预期 HTTPS/本站路径。不要只做一次 HTML 编码后继续多次解码。依赖修改必须通过可重现的补丁机制、受控 fork 或替换包进入 lockfile/构建流程，不能直接编辑 `node_modules`。

**验收要求**：

- [ ] name/artist 为 `<img onerror=...>`、`<style>...</style>`、实体编码和超长文本时，DOM 中只出现文字，不生成元素或样式。
- [ ] 播放器当前曲目、列表、切歌、歌词和正常中英文名称不受影响。
- [ ] 测试直接覆盖 APlayer 最终 DOM sink，而不只测试 API JSON。
- [ ] 删除 `node_modules` 后执行一次干净 `npm ci`，补丁仍自动生效且专项测试通过；Git 中没有手工修改的依赖产物。

---

### ✅ P2-2 匿名评论和互动接口接受跨站简单请求

**问题**：`src/lib/api.ts:7-9` 将“不发送 CORS 响应头”描述为阻止任意站点调用，但 CORS 只阻止读取响应，不阻止 `text/plain` 简单请求发送。评论和互动路由又会解析其 JSON；互动限流键包含可控 User-Agent。

**处理方式**：浏览器写接口要求 JSON 和允许的 Origin；原生/服务端调用制定独立规则。互动限流使用纯 IP，visitor ID 仅用于去重。评论视滥用情况增加挑战、一次性 token 或更强反垃圾策略。

**验收要求**：

- [ ] 外域 `text/plain`/`no-cors` 请求不能新增评论、浏览量或切换点赞。
- [ ] 同源网页和配置的原生客户端仍能提交。
- [ ] 更换 visitor ID 或 User-Agent 不能绕过写入限流。
- [ ] CORS 文档不再把“浏览器不可读响应”表述成服务端访问控制。

---

### ✅ P2-3 修改管理员密码不会撤销已有会话

**问题**：`src/lib/auth.ts:16,83-109` 的会话固定有效 7 天，只校验 token 和过期时间；修改 `ADMIN_PASSWORD` 并重启不会撤销已泄露 Cookie。

**处理方式**：提供“注销全部设备”；推荐在数据库持久化 session generation，并提供受控的“撤销全部会话”管理动作或 CLI 来递增它。当前密码来自环境变量，因此改密运行手册必须把“修改 `ADMIN_PASSWORD` → 递增 generation → 重启 → 验证旧 Cookie 失效”定义为同一次维护操作，不能假设应用能观察到环境文件变化。若另行实现启动时自动检测密码变化，摘要必须使用独立应用密钥做 HMAC，不能保存可用于离线验证密码的信息。

**验收要求**：

- [ ] 当前会话注销只影响当前设备；“注销全部设备”会立即使其他 Cookie 返回 401。
- [ ] 按文档执行环境变量改密流程后，旧 Cookie 无效，新密码可正常登录；漏做 generation 递增会被预检或运行手册中的强提示捕获。
- [ ] generation 递增动作有临时数据库测试，重复执行行为可预测，且不能由未认证请求触发。
- [ ] 数据库、日志和响应中不保存管理员明文密码或可直接复用的会话 token。

---

### ✅ P2-4 临时认证和互动数据没有统一周期清理

**问题**：`cleanupExpiredAuthState()` 只在启动和成功登录时执行；长期无成功登录的进程仍会积累 `login_attempts`。互动 view 清理只在 `scripts/maintain-db.mjs` wrapper 启动时执行，Docker 直接运行 `server.js` 或长期不重启时不会持续清理。

**处理方式**：把两类清理纳入统一的低频调度任务，使用单实例/数据库锁防止多进程并发；清理失败只告警，不阻断请求。

**验收要求**：

- [ ] 不重启服务且没有成功登录时，超过保留期的 attempts 和 interactions 会在约定周期内删除。
- [ ] 多实例同时启动不会形成高频清理或 SQLite 锁风暴。
- [ ] 清理只删除符合时间、target 和 kind 条件的记录，并有临时数据库测试。

---

### ✅ P2-5 备份同名竞态及遗留 WAL/SHM

**问题**：`src/lib/backup.ts:35-46` 使用秒级文件名且没有独立互斥；同秒任务可能写同一路径，一个失败任务还可能删除另一个有效结果。`src/lib/backup-verification.ts:19-41` 打开 WAL 模式备份后会留下 `-wal/-shm`，保留清理只删除 `.db`；审计时本地已有 6 个 sidecar 文件。

**处理方式**：使用毫秒时间戳加随机后缀和独占临时文件，成功校验后原子 rename；备份/保留使用独立锁。验证使用不遗留 sidecar 的只读方式，或在完成后安全清理对应 WAL/SHM，并加入 `foreign_key_check`。

**验收要求**：

- [ ] 两个同秒并发备份都会得到唯一文件，或一个被明确锁拒绝；不会互删。
- [ ] 模拟一个任务失败不会删除另一任务的成功备份。
- [ ] 完成和保留清理后不存在无主 `blog-*.db-wal`/`blog-*.db-shm`。
- [ ] 每个成功备份通过 `integrity_check`、`foreign_key_check` 和核心表检查。

---

### ✅ P2-6 裁切附件写 DB 失败时会留下孤儿文件

**问题**：`src/app/api/admin/attachments/[id]/crop/route.ts:66-67` 先写文件再写数据库，没有沿用 `src/lib/upload-storage.ts:4-17` 的补偿删除逻辑。

**处理方式**：裁切入口复用 `writeUploadWithRecord` 或等价的“文件成功、DB 失败则删除文件”原语。

**验收要求**：

- [ ] mock DB 插入失败后，新裁切文件不存在，原附件保持不变。
- [ ] 文件写入失败时不创建附件记录。
- [ ] 正常裁切仍生成权限正确、签名正确且有数据库记录的文件。

---

### ✅ P2-7 `b23.tv` 短链被列为支持但无法解析

**问题**：`src/lib/video.ts:32-37` 允许 `b23.tv` 主机，但紧接着只识别 `/video/BV...`；真实 `https://b23.tv/<opaque-id>` 会被当作普通文本。完整 Bilibili URL、BV/av ID 和 YouTube URL/ID 当前正常。

**处理方式**：二选一并写入 UI/README：

- 移除伪支持，明确提示用户先展开短链；或
- 只在管理员插入/保存阶段，通过现有安全远程抓取逐跳展开，最终只保存 BV/av ID。公开页面渲染时不得联网展开。

**验收要求**：

- [ ] 选择“不支持”时，编辑器给出明确错误，不再静默退回普通文本。
- [ ] 选择“支持”时，合法 b23 短链最终保存固定 Bilibili ID；跳向私网、非 Bilibili、超限重定向均被拒绝。
- [ ] 完整 URL、BV、av、分 P 参数、YouTube 及旧 fenced 写法均通过回归测试。

---

### 🟨 P2-8 CI 缺少部署状态机和关键边界回归

**问题**：现有 CI 覆盖 lint、类型、单元/集成、build、standalone smoke 和 E2E，但没有测试真实部署状态机；QQ 会话/路由、备份调度、works/taxonomy 等关键模块覆盖率也明显偏低。

**处理方式**：把部署 runner、sidecar client、时间和进程管理依赖抽成可注入边界；新增本清单要求的专项测试。GitHub Actions 中保留生产构建和 standalone smoke。

**验收要求**：

- [ ] P0-1、P0-2、P1-1 至 P1-8 的每项关键失败路径均有自动化测试，不依赖真实 GitHub、PM2、QQ 或公网。
- [ ] CI 能检测部署前置检查顺序、原子切换、健康失败回滚和锁生命周期回归。
- [ ] 总覆盖率不得低于当前 package 阈值；新安全/部署代码的关键分支应接近完整覆盖，不能靠无关文件抬高总数。
- [ ] E2E 使用临时数据库；测试结束不修改 Git 工作树或真实 `data/`。

---

## 已有保护的强制回归清单

以下不是待重新设计的功能，而是整改时必须保持的安全基线：

- [ ] 生产 CSP 的 `script-src` 继续使用逐响应 nonce + `strict-dynamic`，不得恢复 `'unsafe-inline'`；Markdown 原始 HTML继续转义并经过 `sanitize-html`。
- [ ] Markdown iframe 继续只由固定 Bilibili/YouTube ID 构造，并受 CSP `frame-src` 限制。
- [ ] 搜索保持 FTS 优先、候选最多 100、无健康 FTS 的“0 命中全表回退”，公开路由继续有滥用保护。
- [ ] 上传继续保留 MIME 白名单、魔数、60MP 像素上限、随机文件名、路径根校验、文件权限和入库记录。
- [ ] SSRF 防护继续保留私网/metadata/IPv4/IPv6 检查、逐跳验证和 socket DNS 绑定。
- [ ] SQL 继续全部参数化，migration 继续事务化并维护 `user_version`。
- [ ] session token、IP、UA/visitor 标识不得明文入库；会话令牌继续只存哈希。
- [ ] 密码比较继续先做固定长度摘要再 `timingSafeEqual`。
- [ ] 正确密码继续可以越过账户级全局失败锁；本清单 P1-1 还要求其可以安全越过 IP 锁。
- [ ] `.env.local`、SQLite/WAL/SHM 保持 `0600`；`data`、backups、uploads 目录保持非全局可读。
- [ ] 构建阶段继续使用 `BLOG_BUILD_READONLY=true`，不得迁移、清理或写入正式数据库。

## 建议实施顺序与依赖

| 阶段 | 条目 | 说明 |
| --- | --- | --- |
| 1 | P0-1 QQ 接口 | 可独立实施；先止住匿名上游放大 |
| 2 | P1-8 schema 保护 + P1-5 PM2 边界 + P0-2 部署 | 作为同一交付设计：先确定 schema/数据库回滚策略和稳定环境，再实现 PM2 预检、回环监听、release 切换、健康检查与回滚；不得先上线只能回滚代码的部署器 |
| 3 | P1-1/P1-2/P2-2 请求来源边界 | 统一设计 Web Cookie、Server Actions 和原生 API 认证，避免三套规则互相冲突 |
| 4 | P1-3 抓取超时 + P1-4 上传 | 都涉及请求体/流生命周期与代理边界，可并行实施 |
| 5 | P1-6 feed + P1-7 备份 | 数据性能和灾难恢复，可独立实施 |
| 6 | P2 其余项 | 纵深防御、维护和功能修正 |

## 每项完成定义（Definition of Done）

只有同时满足以下条件才可把条目标记为 ✅：

- [ ] 根因已消除，而不是只隐藏 UI、吞掉错误或增加注释。
- [ ] 本项全部验收复选框完成。
- [ ] 新增针对成功、失败、边界和滥用路径的自动化测试。
- [ ] 相关 README、部署示例、API 文档和环境变量示例同步更新。
- [ ] 没有把密钥、Cookie、真实 IP、数据库、备份、上传或测试产物加入 Git。
- [ ] 运行“整体验收命令”并记录结果。
- [ ] `git diff` 只包含本项及必要耦合改动；不夹带格式化全仓库或无关重构。

## 本地/CI 整体验收

以下包装显式把 build 指向系统临时目录；不要删掉前置环境变量后直接运行 `npm run build`。`test:production` 和 Playwright 当前也会各自创建临时数据目录。若后续新增统一验证脚本，应由脚本创建并校验临时路径，再替换这段手工包装。

```bash
AUDIT_TEST_ROOT="$(mktemp -d /tmp/yezi-audit.XXXXXX)"
test -n "$AUDIT_TEST_ROOT"
export BLOG_ROOT="$AUDIT_TEST_ROOT"
export BLOG_DB_PATH="$AUDIT_TEST_ROOT/data/blog.db"
export ADMIN_PASSWORD="audit-local-only-password"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:3100"
export SESSION_COOKIE_SECURE="false"
export TRUST_PROXY="false"
unset BLOG_BUILD_READONLY

npm audit --json
npm run check
npm test
npm run test:coverage
npm run build
npm run test:production
npm run test:e2e
git status --short
```

运行前后必须确认 `BLOG_DB_PATH` 以 `/tmp/yezi-audit.` 开头且不等于仓库内 `data/blog.db`。临时目录不需要在验收命令中递归删除；确认路径无误后再由操作者单独清理。

本地/CI 额外检查：

- [ ] 生产 CSP 中不存在 `script-src 'unsafe-inline'`，nonce 与页面脚本匹配。
- [ ] 大文件上传经过临时 production Proxy/standalone + 测试 Nginx 路径，而不是直接调用函数。
- [ ] 部署测试使用假 PM2/Git/HTTP runner，没有修改真实进程或远端仓库。
- [ ] 临时测试数据、Playwright 产物和构建产物没有进入 Git。
- [ ] 若修改数据库 schema，已同时验证升级、未来版本拒绝、备份恢复和部署回滚策略。

## 生产/外部基础设施验收（需用户授权）

以下项目会改变真实进程、网络、备份目标或远端数据。接手模型只能在用户明确授权具体环境与范围后执行；未授权时应保留为待验收并记录，不得用本地模拟结果冒充生产结果：

- [ ] 在指定服务器验证 PM2 固定名称、稳定外部环境、`127.0.0.1:3030` 监听、防火墙和可信 Nginx 转发头。
- [ ] 在维护窗口演练真实 release 切换、健康检查失败、数据库兼容处理和自动回滚；演练前已有可验证恢复点。
- [ ] 经真实 Nginx 验证 20 MiB 文件成功、21 MiB 应用请求边界及超过 22 MiB 的 Content-Length/chunked 请求返回 413。
- [ ] 在用户指定的异机目标验证加密上传、失败告警、保留策略和隔离恢复；远端删除必须再次核对目标和保留期。
- [ ] 所有生产验收记录环境、时间、操作者、命令/观察结果和回滚结果，但不得记录密钥、Cookie 或原始 IP。

## 验证记录模板

每完成一个条目，在下面追加记录，不要覆盖历史记录：

```markdown
### YYYY-MM-DD — P?-? 条目名称

- 状态：✅ / ⛔ / 🟨
- 实现提交：`<commit>`
- 主要文件：`path/to/file`
- 专项测试：`<command>` → `<result>`
- 整体验收：`<command>` → `<result>`
- 文档更新：`<files>`
- 偏离原方案：无；或说明原因、风险与批准人
- 后续事项：无；或链接到新条目
```

## 验证记录

### 2026-08-25 — 全清单本地整改

- 状态：代码修复已实施；索引中 ✅ 项完成本地验收，🟨 项等待专项或生产基础设施验收。
- 实现提交：工作树尚未提交；提交后补充 commit。
- 主要文件：`src/app/api/music/qq/route.ts`、`scripts/deploy-release.mjs`、`src/lib/request-security.ts`、`src/lib/data-backup.ts`、`src/lib/db/feed.ts`、`src/lib/db/migrations.ts`、`scripts/production-smoke.mjs`。
- 专项测试：允许集合/歌词签名/single-flight、Bearer/CSRF、session generation、未来 schema、千级 feed、周期清理租约、并发 DB 备份、加密完整归档、APlayer DOM sink、b23 明确拒绝均通过。
- 整体验收：`npm run check` → 通过；`npm test` → 110/110；`npm run test:coverage` → 81.13% lines / 76.31% branches / 76.02% functions（新增最后几项测试前的最近一次完整覆盖率，门槛通过）；`npm run build` → 通过；`npm run test:production` → 通过，包含 standalone、CSP、SQLite/FTS、IP/账户锁正确密码、11 MiB/20 MiB/超限/未认证上传；`npm run test:e2e` → 12/12。
- 文档更新：`README.md`、`.env.local.example`、`deploy/nginx.conf.example`、本清单。
- 偏离原方案：P2-7 选择“不支持 b23 不透明短链并明确提示展开”，而非管理员端联网展开；P1-7 只实现本地加密归档与目录型镜像适配器，没有在未获授权时接入真实远端。
- 后续事项：P0-2/P1-8/P2-8 仍需 fake PM2/Git 部署状态机的完整失败注入；P1-3 仍需可控慢滴响应体专项测试；P1-4/P1-5/P1-7 仍需按“生产/外部基础设施验收”在用户指定环境验证。真实 PM2、Nginx、防火墙、QQ sidecar、远端备份和恢复均未在本次本地整改中改动。
