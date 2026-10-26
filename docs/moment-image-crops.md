# 絮语缩略图位置与缩放

配套 App：TestFlight 1.0（38）。本改动基于网站 main `60472dc` 整合，保留已上线的备份、通知、评论与音乐功能，不包含其他工作区未提交内容。更新网站代码并重新构建、重启后生效；服务器部署由站点维护者执行。

## 数据契约

原生 App 的 POST / PATCH `/api/admin/v1/moments` 请求新增可选 `imageCrops`。管理 API 和公开 `/api/v1/moments` 均返回此字段：

```json
{
  "images": ["/uploads/a.jpg"],
  "imageCrops": {
    "/uploads/a.jpg": { "x": 0.75, "y": 0.5, "zoom": 2, "aspectRatio": 1.3333333333333333, "originalAspectRatio": 1.5 }
  }
}
```

- `x`、`y` 是超出展示窗口的可移动距离比例，范围 0–1，对应 CSS `object-position`；`zoom` 为填满展示窗口后的额外缩放，范围 1–4。不同窗口比例使用同一位置设置，不保证裁切矩形像素相同。
- 可选 `aspectRatio` 为用户选定的宽高比（0.05–20），支持自由调整及固定比例。可选 `originalAspectRatio` 为原图宽高比，供单图按原比例排版，避免为获得尺寸重复下载原图。两字段都可省略，兼容原来的位置/缩放记录，不需要新增数据库迁移。
- iOS 比例选项为「跟随网站 / 自由 / 原图 / 1:1 / 4:3 / 3:4 / 16:9」。自由模式拖动右下角改变框比例，框内仍可移动图片和双指缩放。跟随网站省略 `aspectRatio`：单图采用原比例，多图沿用各页面布局；固定或自由比例设置后，App 与网页列表按指定比例显示。原图按钮采用实际图片比例。
- 缺省按居中、1 倍显示。更新省略字段保留现有设置；显式 `{}` 清空；图片移除时同步丢弃该路径的参数；排序不影响按路径关联的设置。
- 参数仅作用于列表缩略图。灯箱仍读取 `images` 原始地址，不改图、不创建附件、不重复上传。
- 网站编辑器仍能编辑这些絮语；旧编辑器不提供该字段时，DAO 保留未被删除图片的设置。本轮可视化拖动和缩放入口位于 iOS 图片附件菜单。
- 鉴权与写操作权限保持不变；非法数值与越界参数返回业务错误。前台解析旧记录或损坏 JSON 时回落居中显示。

## 数据库与发布顺序

迁移 19 新增 `moments.image_crops TEXT NOT NULL DEFAULT '{}'`，保留原 `images` 字符串数组，兼容旧客户端。迁移 18 沿用主线的 iOS 通知表，不更改已发布的迁移编号。网站运行时迁移会执行此步骤；正式部署前按既有备份流程备份数据库。回滚代码无需删除该列。

先部署网站，再发布包含新编辑器的 App。旧网站会忽略额外字段，无法持久保存新 App 的缩略图设置。App 本地草稿与预览不依赖网站新字段，但跨设备和网页展示依赖网站部署。

## 验证

- 与 main `60472dc` 整合并安装锁定依赖后，完整测试 395 项通过、1 项跳过，`npm run check`（类型检查和全仓 Lint）、生产构建均通过。升级测试从主线版本 18 执行迁移 19，确认原图片及通知状态保留；日志 `/private/tmp/yezi-thumbnail-main-tests-final.log`、`/private/tmp/yezi-thumbnail-main-check-final.log`、`/private/tmp/yezi-thumbnail-main-build-final.log`。
- `npm test`：217 项通过，包括新增的真实 Bearer API 创建/更新、公开读取、旧版请求保留、恢复默认、移除图片、非法参数与拒绝未认证请求；迁移保留旧行并可重复运行。
- TypeScript 类型检查、修改文件 ESLint、生产构建通过。
- 比例扩展后再次通过 217 项测试、类型检查、ESLint 与生产构建；验证固定/自由比例字段写入、公开读取、旧请求保留、原图比例与跟随布局、非法比例拒绝。对应日志前缀 `/private/tmp/yezi-thumbnail-ratios-web-`。
- 使用隔离样例数据库启动本机生产预览，浏览器实测右侧局部放大有效，点开仍显示完整原图。未修改正式内容。
- 日志：`/private/tmp/yezi-thumbnail-web-all-tests.log`、`/private/tmp/yezi-thumbnail-web-types-final.log`、`/private/tmp/yezi-thumbnail-web-lint.log`、`/private/tmp/yezi-thumbnail-web-build.log`。
