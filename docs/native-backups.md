# 原生 App 备份与评论接口

本次增加的管理接口继续使用现有 admin_session / Bearer 鉴权，写操作沿用 CSRF 检查；数据和下载响应不缓存。

App 使用独立的 `native-backups` 路径；网站现有 `/api/admin/v1/backups` 完整备份、文件管理和云备份接口保持原协议。原生任务与网站云备份、本地备份及附件操作共用锁，避免同时切换或复制数据。任务记录与恢复暂存目录不进入新的归档。独立 worker 只导入文件锁模块，不因加载云备份配置而持有在线数据库连接。

## 接口

- `GET /api/admin/v1/moments`：每条增加 `comment_count`（所有状态，管理员回复不额外计数），一页一次聚合查询。已有 `location`、`tags` 原样返回。
- `GET /api/admin/v1/comments?target_type=moment&target_id=123`：目标参数必须成对、类型为 post/moment，ID 为正整数；状态、分页和总数沿用原规则。不传目标仍是原独立评论页。
- `GET /api/admin/v1/native-backups`：`data.backups` 列表含 id/name/kind/size/createdAt，`job` 为最近任务；`completeEnabled`、`restoreEnabled` 告知功能配置。id 是服务器生成的逻辑标识，不接受任意文件路径。
- `POST /api/admin/v1/native-backups`：`{action:"create",kind:"database"|"complete"}` 创建后台任务。恢复使用 `{action:"restore",kind,backupId,confirmation:backupId}`，仅接受服务器备份列表中已有的文件，不支持任意上传归档。
- `GET /api/admin/v1/native-backups/download?id=...`：鉴权后流式下载，未授权或路径越界不能读取文件。

## 部署前提与恢复边界

先部署网站，再更新 App。源码目录需包含 `scripts/backup-worker.mjs`、`scripts/backup-resolve.mjs`、既有独立启动器以及对应 `src/lib` 模块；独立任务需要支持 `--experimental-strip-types` 的 Node（建议 22.18+）、tar 和项目依赖。`DEPLOY_PROJECT_DIR` 指向该源码目录，`BLOG_ROOT` 指向持久化站点根目录。

数据库备份沿用 `BLOG_DB_PATH` / `BLOG_BACKUP_DIR`；完整归档沿用 `DATA_BACKUP_KEY`（32 字节 base64）、`DATA_BACKUP_KEEP` 和镜像配置。加密密钥不返回 App，不保存在归档内，需要另外保管。没有配置密钥时数据库备份仍可用。

恢复要求唯一、在线且目录属于本站的 PM2 进程，名称默认 `yezi-blog`，可配置 `DEPLOY_PM2_NAME`；direct 部署不提供自动恢复。完整恢复要求标准 `BLOG_ROOT/data/blog.db` 布局。数据库恢复保留现有附件，若快照所引用附件缺失或大小不符会拒绝恢复。

完整恢复覆盖数据库、上传附件及持久化数据，不覆盖源代码、环境文件、备份目录、任务记录、部署版本标记及可再生成的音频缓存。归档必须先完成 AES-GCM 认证，通过路径/特殊文件检查和数据库/附件一致性校验，才能停机。

任务与部署互斥。恢复在停止 PM2 后创建当前数据备份，再切换文件；启动期间沿用部署写保护，健康检查通过才解除。失败先停止候选进程、回退原文件，再重启。数据库中的旧登录会话被清空，用户需重新登录后查看最终状态。

安全快照保留在备份列表；原文件恢复记录另外保存在 `data/backup-jobs/recovery-<id>/`，便于检查，暂不自动删除。任务日志和最近状态在 `data/backup-jobs/`。进程意外退出或自动回退失败时保留锁；不要直接删除锁后重试，先检查 `journal.json`、当前数据库和 PM2 状态，确认不存在运行任务且原数据完整后再由管理员清理。

## 验证

`node --experimental-strip-types --import ./tests/register-alias.mjs --test tests/native-backups-comments.test.mjs tests/backup.test.mjs tests/comments.test.mjs tests/admin-auth.test.mjs`

测试只使用临时数据、伪 PM2 与本地健康服务，不调用真实 PM2，也不恢复线上站点。生产 PM2 权限、真实服务器目录和大体积归档的停机耗时仍应在部署环境验收。
