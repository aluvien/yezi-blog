# 中文字体分片的字符排序

`font-character-order.txt` 只保存原始常用字库所含的 3500 个汉字，按公开词频推导的字符得分降序排列。
不读取本站文章、数据库、访问记录或任何账号信息。

数据来源：jieba 项目 `jieba/dict.txt`（MIT，许可证见 `LICENSE-jieba.txt`）。

- 上游地址：`https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt`
- 使用的原始文件 SHA-256：`7197c3211ddd98962b036cdf40324d1ea2bfaa12bd028e68faa70111a88e12a8`
- 每行格式：词语、词频、词性；把每个词的词频累加到词中的每个字符。
- 仅保留 `noto-serif-sc-400-cjk-common.woff2` 实际支持的 `U+4E00–U+9FFF` 字符。
- 排序键为 `(-字符得分, Unicode 码点)`；文件采用 UTF-8，一行字符加结尾换行。

正常生成字体分片只需要仓库中的字符排序文件，无需连接上游或安装 jieba。
