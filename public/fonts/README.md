# 站点字体

经典主题保留 Noto Serif SC（400 / 600）和 LXGW WenKai Lite（400）的原始字形。
中文字库按 Unicode 字符切分，由浏览器通过 `unicode-range` 选择当前页面需要的分片；
拉丁字库沿用现有文件，所有字体使用 `font-display: swap`。

## 更新字库分片

生成结果已纳入源码，正常安装、构建和部署不需要 Python 或联网下载字体。
只有更新原始字体或调整分组时才需要重新生成：

```sh
python3 -m venv /tmp/yezi-font-tools
/tmp/yezi-font-tools/bin/python -m pip install -r scripts/font-subsets-requirements.txt
/tmp/yezi-font-tools/bin/python scripts/build-font-subsets.py
node --test tests/font-assets.test.mjs
```

- 输入：本目录原有的 `*-cjk-common.woff2`、`*-cjk-ext.woff2`。
- 常用字分组：`scripts/font-character-order.txt` 保存基于 jieba 开源词典词频推导的字符次序，常用字集中、低频字使用更小分片。
- 扩展字分组参考：已随项目分发的 `chiron/css/vf.css`；未包含的字符仍完整保留。
- 输出：`subsets/*.woff2`、`subsets/manifest.json`、`src/app/whono/styles/fonts.generated.css`。
- 分片名称含内容摘要，字库更新后会使用新 URL。
- 生成器会重新读取分片二进制，检查字符映射无缺失、无重叠；不会读取数据库或网站内容。
- 原始字体文件保留为可复现的生成输入，运行时 CSS 不再引用整份中文字库。

版权与许可证见 `OFL-NotoSerifSC.txt`、`OFL-LXGW-WenKai-Lite.txt`，Chiron 见其目录中的许可证。
字频排序的数据来源与许可证见 `scripts/font-character-order-source.md`、`scripts/LICENSE-jieba.txt`。

反向代理应保留程序返回的缓存头：字体缓存 7 天，带摘要的 Next.js 静态资源缓存一年。
不要使用统一的 `expires 1m` 覆盖这些响应。
