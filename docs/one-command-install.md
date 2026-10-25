# 新服务器一键安装

目标流程：**安装博客与音乐服务 → 打开后台 → 恢复备份**。支持 Debian 11+、Ubuntu 22.04+ 的 x86_64 / arm64 服务器，包含普通 Linux、宝塔和 aaPanel。

以下远程命令从 GitHub `main` 获取安装器与网站源码。已有完整源码时，也可以在源码目录执行 `sudo python3 scripts/install/install.py --domain example.com`。

## 一条命令

将 `example.com` 换成自己的域名。在服务器的 root 终端执行：

```bash
curl -fsSL https://raw.githubusercontent.com/aluvien/yezi-blog/main/scripts/install.sh | bash -s -- --domain example.com --https --accept-acme-terms
```

命令会展示安装计划，输入 `yes` 开始。`--https --accept-acme-terms` 表示使用 Let’s Encrypt 自动签发 HTTPS 证书，并同意其[服务条款](https://letsencrypt.org/repository/)。域名 A/AAAA 记录应正确指向新服务器，公网 80、443 端口应可访问；安装器不会修改 DNS、云安全组或整个服务器的防火墙。如果 DNS 尚未完成，证书申请失败后可在修复 DNS 后重复原命令继续。

需要由面板自行管理证书时，先使用 HTTP 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/aluvien/yezi-blog/main/scripts/install.sh | bash -s -- --domain example.com
```

HTTP 安装后，在面板配置 HTTPS，并将博客 `.env.local` 中的 `NEXT_PUBLIC_SITE_URL` 改为 HTTPS 地址、`SESSION_COOKIE_SECURE=true`、`DEPLOY_DIRECT_HTTP=false`，重启博客。后台「站点设置」若已经设置过网站地址，也应更新为 HTTPS 地址。

命令可以省略 `--domain`，安装器会从终端询问域名。无人值守运行再加 `--yes`。普通 sudo 账户将管道末尾换成 `sudo bash -s -- ...`。

## 自动完成的工作

1. 检查操作系统、CPU、至少 6 GiB 可用空间、内存与 swap 合计至少 2 GiB、目录、端口和同名进程。不会升级操作系统或自动添加 swap。
2. 自动识别面板，优先复用已有的 Node 22.23.3 或更高的 22.x；没有则从 Node 官方下载 22.23.3 并验证 SHA-256。安装编译工具，确保 SQLite 原生模块可以针对当前 glibc 编译。
3. 安装博客及锁定版本的 QQ 音乐 API 3.1.0，生成随机后台密码、签名密钥和当前服务器的绝对路径配置，完成生产构建。
4. 使用同一个 root PM2、`PM2_HOME=/root/.pm2` 和明确的 Node 路径，启动 `yezi-blog`、`api_music_yezi_me`。未安装 PM2 时安装 7.0.4。音乐服务只监听回环地址。
5. 面板环境通过面板自身的项目接口登记两个服务，设置命令行 Node，校验面板状态；普通 Linux 自动安装 Nginx。创建反向代理，支持最大 1 GiB 请求体，便于上传恢复包。
6. 可选自动申请 HTTPS，配置续期及 Nginx 重载。保存 PM2 开机启动，检查博客、音乐和域名反向代理。安装完成不填充演示数据。

宝塔/aaPanel 须已安装 **Nginx 和 Node.js 版本管理器组件**，并支持新版 PM2 项目接口。Node 运行时和 PM2 本身可由安装器安装。面板组件缺失、旧面板接口不兼容时，会在安装前明确提示；不会另装一套系统 Nginx 与面板争抢端口。兼容依据：宝塔当前项目接口、[aaPanel Node 项目文档](https://www.aapanel.com/docs/Function/Node.html)及其公开 PM2 模块；不同面板版本仍需要实际验收。

| 项目 | 默认值 |
| --- | --- |
| 博客目录 | `/www/wwwroot/example.com` |
| 音乐目录 | `/www/wwwroot/api.music.example.com` |
| 博客端口 | `127.0.0.1:3030` |
| 音乐端口 | `127.0.0.1:3200` |
| 后台 | `https://example.com/admin`（未选择 HTTPS 时为 HTTP） |
| 后台密码 | 完成时在交互终端显示；也保存在博客目录 `.env.local` 的 `ADMIN_PASSWORD`，权限 0600 |

自定义目录和端口：

```bash
sudo python3 scripts/install/install.py --domain example.com \
  --dir /www/wwwroot/yezi.me --music-dir /www/wwwroot/api.music.yezi.me \
  --port 3030 --music-port 3200
```

已有目录可以为空；非空目录、已绑定的同域名、其他服务占用端口、已有同名项目都会停止安装。不会自动接管已有博客。已有 root PM2 和开机服务必须与所选 Node 环境一致，避免影响服务器其他程序。

安装中断后使用**完全相同的参数**重试，会按安装记录继续，保留已生成的密码、数据和成功步骤。已完成的安装再次执行只检查服务；升级使用后台「同步 GitHub」。不要删除 `.yezi-install.json` 后在非空目录强行重装。

`python3 scripts/install/install.py --domain example.com --check` 只做预检查。远程 `install.sh` 启动器仍需要临时下载源码，缺少 Python/Git 时会安装这些启动依赖。

## 恢复旧站

1. 用新生成的后台密码登录，进入「设置 → 备份与恢复」。
2. 本地备份：上传完整备份包，校验并查看预览，然后确认恢复。云备份：填写旧 WebDAV 地址、账户、密码，导入旧站单独导出的恢复密钥，选择对应备份并预览、恢复。不同域名的备份在「其他网站备份」中查找。
3. 恢复完成后重新登录，核对文章、图片、站点名称和网站地址。迁移到新域名时，在后台设置新地址。QQ 登录可能被上游撤销，必要时重新扫码。

恢复会导入数据库、附件和应用的持久化状态；**新服务器的环境文件、运行路径、PM2 与云端连接设置会保留**。因此后台密码仍是新安装时生成的密码。Telegram、LLM、APNs 等服务器密钥需要对照完整备份中的配置文件补回并重启；APNs `.p8` 等站外私钥、服务器证书、Nginx 和面板本身不属于应用数据恢复。云备份恢复密钥与 `.env.local` 的 `DATA_BACKUP_KEY` 是不同用途，不能混用。

自动 HTTPS 模式由 Certbot 管理证书续期；避免同时让面板覆盖同一域名的证书配置。如果改由面板接管证书，应相应停用该域名的 Certbot 续期设置。

## 验证

```bash
bash -n scripts/install.sh
python3 -m unittest discover -s tests -p install_test.py
```

测试覆盖已有数据保护、断点恢复归属、参数注入、私密文件权限、进程/端口冲突、PM2 环境隔离与反向代理配置。完整安装应另外在一次性 Linux 环境执行；不要在已有生产服务器用安装器做试装。

本次验证：18 项自动检查通过；Ubuntu 22.04 arm64 隔离环境实际完成依赖安装、生产构建、博客和音乐启动，验证后台登录、空数据库、Nginx 反向代理、回环监听、断点继续与重复执行。HTTPS 配置通过 Nginx 校验。容器没有 systemd PID 1，因此开机服务只验证了生成的配置，未测试真实重启；宝塔接口完成只读验证，未在新面板上执行真实项目创建，也未申请公网证书。
