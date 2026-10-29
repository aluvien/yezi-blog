# 絮语附件位置（iOS 1.0 build 45）

网站部署后，启动迁移 v21 为 moments 增加可空的 image_placement、music_placement。旧记录不改变展示顺序；已有缩略图裁剪数据不变。

- GET /api/admin/v1/moments/layout：沿用后台鉴权，返回 data.supported=true；禁止缓存。App 保存自定义位置前调用该接口。
- POST /api/admin/v1/moments、PATCH /api/admin/v1/moments/:id：接受 imagePlacement/musicPlacement，也接受 snake_case。仅允许 top、bottom、null；缺省更新保留原值，null 恢复旧顺序。
- 后台与公开 API 返回 image_placement、music_placement。网站前台按位置展示整组图片和非折叠音乐；折叠音乐仍在作者行。

上线顺序：部署网站并完成迁移，再在 App 45 中重试保存。无需重新安装 App。保存仍失败时不要丢弃本地草稿。

验证：15 项附件位置、缩略图、迁移和 Bearer 接口测试通过；类型检查及正式构建通过。正式构建本机请求验证未登录 401，带测试令牌 200 且 supported=true。所有写入测试只使用临时数据库。
