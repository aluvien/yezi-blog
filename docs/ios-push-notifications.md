# iOS 通知接入

App Bundle ID 固定为 `me.aluvien.yeziblog`。服务器通过 APNs HTTP/2 token authentication 发送，不依赖 App 后台轮询。

## 配置与上线

1. Apple Developer 中为此 Bundle ID 开启 Push Notifications，更新签名描述文件。Xcode target 已声明 capability；Debug 的 `aps-environment` 为 development，Release / TestFlight 为 production。
2. 设置服务器环境变量：`APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_KEY_PATH`、`APNS_SITE_URL`（此服务器的 HTTPS 根地址，例如 `https://yezi.me`）。密钥文件建议权限 0600，放在源码和备份目录以外。也可通过部署平台 secret 注入 `APNS_PRIVATE_KEY`，不与 KEY_PATH 同时配置。
3. 已有 `.p8` 只有在属于同一开发团队、未撤销、授权范围包含本 App topic 与环境时才可复用。不可使用其他团队或其他 topic 专用的 key。
4. 部署网站并重启运行进程，启动迁移将增加 schema 18 的设备、发送队列与健康事件状态表。部署 App 到真机，在「管理 → 通知」开启权限，选择通知内容，点击「发送测试通知」。服务器返回 queued 只表示入队；APNs Accepted 也不等于设备实际展示，最终需真机确认。

未配置密钥时网站仍正常工作，注册接口返回可读错误；不会保存积压的历史评论通知。当前本地私有 `.env.local` 已引用用户确认的 APNs 密钥，权限 0600 且由 Git 忽略。文件已从 iCloud 下载，P-256 格式与本地 ES256 签名/验签通过；Team ID 沿用 App 开发团队，尚未向 Apple 验证团队及授权范围。自动测试不连接 Apple 服务，生产服务器凭证配置、部署及真机通知仍待完成。

## 事件和生命周期

- 新评论提交后入队，独立于 Telegram 的开关。点击通知通过登录 API 读取准确的评论 ID，打开回复页；已删除评论显示错误，不通过扫描所有分页查找。
- QQ 音乐沿用网站的健康检查调度。只有明确 expired，或先前有会话而现在 missing_session，才触发。网络异常、探测歌曲不可播放不会当成登录过期。独立持久化状态避免每次检查重复提醒；恢复后可开始下一次失效事件。
- 每台设备可独立选择新评论、QQ 音乐失效。服务端固定 APNs topic，不接受客户端指定任意 topic、URL、通知正文。
- 设备绑定当前 App 登录会话。退出登录、改密撤销会话、会话到期后停止发送；重新登录并开启 App 时重新绑定。通知不会无限跨越已失效的登录会话。
- App 不在启动时弹权限框，需用户主动开启。前后台恢复时仅检查系统授权和设备注册；相同绑定不重复提交。关闭权限时撤销服务器设备绑定。
- 通知仅路由至当前已登录站点，不根据 payload 自动切换服务器或跳转任意链接。切换站点前解除绑定。

## 安全与交付语义

设备注册/删除/测试 API 使用现有登录 Cookie、Origin 与 `X-Yezi-CSRF` 校验；拒绝 Bearer-only 设备注册，避免创建没有实际登录会话的长效订阅。设备令牌只保存于私有数据库，不出现在公开 API 或日志中。数据库备份同样包含设备令牌，按现有私有备份保护处理。

发送队列按事件和设备去重，SQLite 短事务领取任务；每批最多 12 条，每条连接超时 8 秒。临时错误退避重试，最多 8 次，事件超过 1 小时不再发送，记录 7 天后清理。410/无效 token 停用设备；测试通知每台设备每分钟最多一次。网络断开导致 APNs 已接受而服务器未收到确认时可能重试，不能承诺网络故障下严格 exactly-once。恢复/部署写闸门生效时不发送、不写入旧请求结果。

本地验证：`npm run typecheck`、针对改动的 ESLint、`npm test`。新增 `tests/ios-push.test.mjs` 覆盖 JWT 真正签名验证、站点与会话隔离、去重、并行领取、退避、无效设备、QQ 健康事件与接口保护。真实系统通知、后台/冷启动点击、权限拒绝后系统设置恢复，需要配好凭证后的真机验收。
