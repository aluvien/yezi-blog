#!/usr/bin/env python3
"""Fresh-install orchestrator. Root/Linux only; standard Python 3.9+ library.

The receipt is a recovery journal, not permission to adopt an existing website.
No user content is deleted and an interrupted installation can be resumed.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

REPOSITORY = 'https://github.com/aluvien/yezi-blog.git'
NODE_VERSION = 'v22.23.3'
PM2_VERSION = '7.0.4'
MUSIC_VERSION = '3.1.0'
PANEL = Path('/www/server/panel')
RECEIPT = '.yezi-install.json'
ECOSYSTEM = 'ecosystem.install.config.cjs'
NAMES = ('yezi-blog', 'api_music_yezi_me')


class InstallError(Exception):
    pass


def run(args, *, cwd=None, env=None, capture=False, input=None, timeout=1800):
    result = subprocess.run([str(x) for x in args], cwd=cwd, env=env, input=input,
                            text=True, capture_output=capture, timeout=timeout)
    if result.returncode:
        raise InstallError('步骤失败：' + str(args[0]) + '，请检查上方输出；修复后可重复执行安装命令')
    return result.stdout.strip() if capture else ''


def atomic_write(path, text, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise InstallError('拒绝写入软链接：' + str(path))
    fd, temporary = tempfile.mkstemp(prefix='.yezi-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def domain_name(value):
    value = value.strip().lower()
    if len(value) > 253 or '.' not in value or not all(
        re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in value.split('.')
    ):
        raise InstallError('请输入纯域名，例如 blog.example.com，不含协议、端口或路径')
    return value


def safe_directory(value):
    path = Path(value)
    if not path.is_absolute() or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path)):
        raise InstallError('安装目录须为绝对路径，只能包含字母、数字、点、横线和下划线')
    if '..' in path.parts or len(path.parts) < 4 or path.resolve() != path:
        raise InstallError('安装目录不能是系统根目录或包含软链接、..')
    return path


def parent_existing(path):
    while not path.exists():
        path = path.parent
    return path


def validate_locations(root, music):
    if root == music or root in music.parents or music in root.parents:
        raise InstallError('博客和音乐目录不能重叠')


def read_receipt(root, music, domain, port, music_port, https):
    file = root / RECEIPT
    if file.is_symlink():
        raise InstallError('安装记录不能是软链接')
    if file.exists():
        state = json.loads(file.read_text())
        expected = {'format': 1, 'root': str(root), 'music': str(music), 'domain': domain,
                    'port': port, 'music_port': music_port, 'https': https}
        if any(state.get(key) != value for key, value in expected.items()):
            raise InstallError('已有安装记录与本次参数不同，请使用原安装参数重试')
        owner = music / RECEIPT
        if music.exists() and any(music.iterdir()):
            if owner.is_symlink() or not owner.is_file() or json.loads(owner.read_text()).get('root') != str(root):
                raise InstallError('音乐目录已有其他文件，不能接管')
        return state
    for target in (root, music):
        if target.exists() and (not target.is_dir() or any(target.iterdir())):
            raise InstallError('目录已有文件，已停止以保护数据：' + str(target))
    return None


def command_environment(node_dir):
    # Do not import unrelated website credentials or a different user's PM2_HOME.
    return {'HOME': '/root', 'USER': 'root', 'LOGNAME': 'root', 'LANG': 'C.UTF-8',
            'PATH': str(node_dir / 'bin') + ':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'PM2_HOME': '/root/.pm2', 'DEBIAN_FRONTEND': 'noninteractive',
            'NEXT_TELEMETRY_DISABLED': '1'}


def environment_file(root, domain, port, music_port, node_dir, https):
    values = {
        'ADMIN_PASSWORD': secrets.token_urlsafe(24),
        'NEXT_PUBLIC_SITE_URL': ('https' if https else 'http') + '://' + domain,
        'BLOG_ROOT': str(root), 'BLOG_DB_PATH': str(root / 'data/blog.db'),
        'BLOG_ENV_FILE': str(root / '.env.local'), 'HOSTNAME': '127.0.0.1', 'PORT': str(port),
        'TRUST_PROXY': 'true', 'SESSION_COOKIE_SECURE': str(https).lower(),
        'DEPLOY_DIRECT_HTTP': str(not https).lower(), 'DEPLOY_PROJECT_DIR': str(root),
        'DEPLOY_PM2_NAME': 'yezi-blog', 'DEPLOY_PM2_BIN': str(node_dir / 'bin/pm2'),
        'PM2_HOME': '/root/.pm2', 'DEPLOY_HEALTH_URL': f'http://127.0.0.1:{port}/api/health/deploy',
        'QQ_MUSIC_API_URL': f'http://127.0.0.1:{music_port}',
        'QQ_MUSIC_SIGNING_KEY': secrets.token_hex(32),
        'DATA_BACKUP_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
    }
    return ''.join(f'{key}={value}\n' for key, value in values.items())


def ecosystem(name, root, node_dir, port, blog=False):
    # Unquoted field names are required by both panels' ecosystem parser.
    env = {'NODE_ENV': 'production', 'PM2_HOME': '/root/.pm2',
           'PATH': str(node_dir / 'bin') + ':/usr/local/bin:/usr/bin:/bin'}
    if blog:
        env.update({'BLOG_ROOT': str(root), 'BLOG_ENV_FILE': str(root / '.env.local'),
                    'HOSTNAME': '127.0.0.1', 'PORT': str(port)})
    else:
        env['QQ_MUSIC_API_PORT'] = str(port)
    fields = {'name': name, 'cwd': str(root), 'script': str(root / ('scripts/start-standalone.mjs' if blog else 'start.mjs')),
              'interpreter': str(node_dir / 'bin/node'), 'exec_mode': 'fork', 'instances': 1,
              'watch': False, 'autorestart': True, 'restart_delay': 3000, 'kill_timeout': 15000,
              'env': env}
    return 'module.exports = { apps: [{\n' + ''.join(f'  {k}: {json.dumps(v)},\n' for k, v in fields.items()) + '}] };\n'


def nginx_config(domain, port, acme, certificate=False):
    proxy = f'''    client_max_body_size 1024m;
    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 300s;
    }}
    location ~ /\\. {{ deny all; }}
'''
    http = f'''# Managed by Yezi installer. Source files are never a public document root.
server {{
    listen 80;
    server_name {domain};
    location ^~ /.well-known/acme-challenge/ {{ root {acme}; }}
'''
    if not certificate:
        return http + proxy + '}\n'
    return http + f'''    location / {{ return 301 https://{domain}$request_uri; }}
}}
server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
''' + proxy + '}\n'


def check_nginx_domain(binary, domain, allowed_file=None):
    if not Path(binary).exists():
        return
    result = subprocess.run([binary, '-T'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise InstallError('已有 Nginx 配置校验失败，请先修复，安装器不会重载异常配置')
    parts = re.split(r'^# configuration file ([^\n]+):\s*$', result.stdout, flags=re.M)
    sections = [(None, parts[0])] + list(zip(parts[1::2], parts[2::2]))
    for filename, content in sections:
        if allowed_file and filename and Path(filename).resolve() == allowed_file.resolve():
            continue
        configuration = re.sub(r'#[^\n]*', '', content)
        for names in re.findall(r'\bserver_name\s+([^;]+);', configuration):
            if domain in [name.strip('\"\'').lower() for name in names.split()]:
                raise InstallError('Nginx 已配置此域名，安装器不会覆盖已有网站')


def select_node(panel):
    base = Path('/www/server/nodejs' if panel else '/opt/yezi/nodejs')
    candidates = []
    for child in base.glob('v22.*.*'):
        match = re.fullmatch(r'v(22)\.(\d+)\.(\d+)', child.name)
        if match and (child / 'bin/node').is_file() and (child / 'bin/npm').exists():
            version = tuple(map(int, match.groups()))
            if version >= (22, 23, 3):
                candidates.append((version, child))
    return max(candidates)[1] if candidates else base / NODE_VERSION


def install_node(directory, env):
    if (directory / 'bin/node').exists():
        actual = run([directory / 'bin/node', '--version'], capture=True, env=env)
        if actual != directory.name:
            raise InstallError('Node 目录与实际版本不一致')
        return
    if directory.exists():
        raise InstallError('Node 安装目录不完整，请核对后移走再重试：' + str(directory))
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}[platform.machine()]
    archive = f'node-{NODE_VERSION}-linux-{arch}.tar.xz'
    with tempfile.TemporaryDirectory(prefix='yezi-node-') as temp:
        temp = Path(temp)
        base = f'https://nodejs.org/dist/{NODE_VERSION}/'
        for name in (archive, 'SHASUMS256.txt'):
            run(['curl', '--fail', '--location', '--retry', '3', '--connect-timeout', '20', '--max-time', '900', base + name, '-o', temp / name])
        checksums = dict(line.split()[::-1] for line in (temp / 'SHASUMS256.txt').read_text().splitlines() if line.strip())
        if hashlib.sha256((temp / archive).read_bytes()).hexdigest() != checksums.get(archive):
            raise InstallError('Node 下载校验失败')
        run(['tar', '-xJf', temp / archive, '-C', temp])
        directory.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(temp / archive[:-7]), directory)


def panel_call(action, spec):
    python = PANEL / 'pyenv/bin/python3'
    panel_env = command_environment(PANEL.parent / 'nodejs' / spec.get('version', NODE_VERSION))
    result = subprocess.run([str(python), str(Path(__file__).with_name('panel.py')), action],
                            input=json.dumps(spec), capture_output=True, text=True, timeout=180,
                            env=panel_env)
    for line in reversed(result.stdout.splitlines()):
        if line.startswith('YEZI_ERROR='):
            raise InstallError(line.split('=', 1)[1])
        if line.startswith('YEZI_RESULT=') and result.returncode == 0:
            return json.loads(line.split('=', 1)[1])
    raise InstallError('宝塔/aaPanel 接口不兼容，请更新面板 Node 项目组件后重试')


def pm2_apps(node_dir, env):
    if not Path('/root/.pm2/pm2.pid').exists():
        return []
    pm2 = node_dir / 'bin/pm2'
    if not pm2.exists():
        raise InstallError('已有 root PM2，但所选 Node 下未安装 PM2。请先在面板统一运行环境')
    raw = run([pm2, 'jlist'], env=env, capture=True, timeout=30)
    try:
        return json.loads(raw)
    except ValueError:
        raise InstallError('PM2 客户端与守护进程可能版本不同，请先在面板统一版本')


def check_services(apps, root, music, resume):
    for app in apps:
        if app.get('name') not in NAMES:
            continue
        expected = root if app['name'] == NAMES[0] else music
        if not resume or app.get('pm2_env', {}).get('pm_cwd') != str(expected):
            raise InstallError('同名 PM2 项目已存在，安装器不会停止或覆盖：' + app['name'])


def check_ports(ports, apps):
    # Ownership is checked by cwd and PID, not by a claimed environment variable.
    allowed = {str(app['pid']) for app in apps if app.get('name') in NAMES and app.get('pid')}
    if not shutil.which('ss'):
        for port in ports:
            with socket.socket() as listener:
                try:
                    listener.bind(('0.0.0.0', port))
                except OSError:
                    raise InstallError(f'端口 {port} 已占用；需要 iproute2 来验证进程归属')
        return
    listeners = run(['ss', '-lntp'], capture=True)
    for port in ports:
        for line in listeners.splitlines()[1:]:
            fields = line.split()
            if len(fields) > 3 and fields[3].rsplit(':', 1)[-1] == str(port):
                pids = set(re.findall(r'pid=(\d+)', line))
                if not pids or not pids.issubset(allowed):
                    raise InstallError(f'端口 {port} 已被其他服务占用，请指定其他端口')


def health(port, suffix='/', attempts=40):
    local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(attempts):
        try:
            with local_http.open(f'http://127.0.0.1:{port}{suffix}', timeout=4) as response:
                if response.status == 200:
                    if suffix == '/api/health/deploy' and json.load(response).get('status') != 'ok':
                        continue
                    return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(2)
    raise InstallError(f'端口 {port} 健康检查未通过；请检查对应 PM2 日志后重试')


def preflight_os():
    if os.geteuid() != 0 or sys.platform != 'linux':
        raise InstallError('请在 Linux 服务器以 root 或 sudo 执行')
    values = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    distro, version = values.get('ID', '').strip('"'), values.get('VERSION_ID', '').strip('"')
    if not ((distro == 'debian' and int(version.split('.')[0]) >= 11) or (distro == 'ubuntu' and float(version) >= 22.04)):
        raise InstallError('目前支持 Debian 11+ / Ubuntu 22.04+；不会自动升级操作系统')
    if platform.machine() not in ('x86_64', 'aarch64'):
        raise InstallError('目前支持 x86_64 / arm64')
    if not Path('/run/systemd/system').exists():
        raise InstallError('需要 systemd 以配置开机启动')


def prompt(question, default=''):
    try:
        with open('/dev/tty', 'r+') as tty:
            tty.write(question + (f' [{default}]' if default else '') + ': ')
            tty.flush()
            return tty.readline().strip() or default
    except OSError:
        raise InstallError('非交互执行需要 --domain 和 --yes')


def show_login_password(root):
    # Show the generated password only on the administrator's terminal, not in
    # redirected build logs. The private env file remains the recovery source.
    password = next((line.partition('=')[2] for line in (root / '.env.local').read_text().splitlines()
                     if line.startswith('ADMIN_PASSWORD=')), '')
    try:
        with open('/dev/tty', 'w') as tty:
            tty.write('\n初始后台密码：' + password + '\n请保存此密码。\n')
    except OSError:
        pass


def parser():
    result = argparse.ArgumentParser(description='全新安装叶子博客 + QQ 音乐，自动识别宝塔/aaPanel')
    result.add_argument('--domain', help='例如 yezi.me；提前将 DNS 解析到本机')
    result.add_argument('--dir', help='博客目录，默认 /www/wwwroot/<域名>')
    result.add_argument('--music-dir', help='音乐目录，默认 /www/wwwroot/api.music.<域名>')
    result.add_argument('--port', type=int, default=3030)
    result.add_argument('--music-port', type=int, default=3200)
    result.add_argument('--https', action='store_true', help='自动使用 Let’s Encrypt 签发证书；要求公网 DNS 和 80/443 可达')
    result.add_argument('--accept-acme-terms', action='store_true', help='同意 https://letsencrypt.org/repository/ 服务条款')
    result.add_argument('--yes', action='store_true', help='接受安装计划，自动生成后台密码')
    result.add_argument('--check', action='store_true', help='只检查安装条件，不修改系统')
    result.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2], help=argparse.SUPPRESS)
    return result


def install(args):
    preflight_os()
    domain = domain_name(args.domain or prompt('网站域名（例如 yezi.me）'))
    root = safe_directory(args.dir or '/www/wwwroot/' + domain)
    music = safe_directory(args.music_dir or '/www/wwwroot/api.music.' + domain)
    validate_locations(root, music)
    if not all(1024 <= p <= 65535 for p in (args.port, args.music_port)) or args.port == args.music_port:
        raise InstallError('两个服务端口必须不同，且在 1024–65535 之间')
    state = read_receipt(root, music, domain, args.port, args.music_port, args.https)
    panel = PANEL.is_dir()
    if state and state.get('panel', panel) != panel:
        raise InstallError('面板环境与上次安装不一致，请先核对服务器环境')
    node_dir = Path(state['node']) if state else select_node(panel)
    env = command_environment(node_dir)
    apps = pm2_apps(node_dir, env)
    check_services(apps, root, music, state is not None)
    check_ports((args.port, args.music_port), apps)
    if panel:
        info = panel_call('probe', {'domain': domain})
        for project in info['projects']:
            expected = str(root if project['name'] == NAMES[0] else music)
            if not state or project['path'] != expected:
                raise InstallError('面板中已存在同名项目，安装已停止')
        if info['domain_used']:
            owner = info.get('domain_owner') or {}
            if not state or owner.get('name') != NAMES[0] or owner.get('path') != str(root):
                raise InstallError('面板中已绑定此域名，请使用未绑定的域名安装，避免覆盖已有网站')
        if not Path('/www/server/nginx/sbin/nginx').is_file():
            raise InstallError('请先在宝塔/aaPanel 软件商店安装 Nginx，再执行同一命令')
    nginx = '/www/server/nginx/sbin/nginx' if panel else '/usr/sbin/nginx'
    conf = Path(f'/www/server/panel/vhost/nginx/node_yezi-blog.conf' if panel else '/etc/nginx/conf.d/yezi-blog.conf')
    if conf.exists() and not state:
        raise InstallError('已有网站配置文件，安装器不会覆盖：' + str(conf))
    check_nginx_domain(nginx, domain, conf if state else None)
    if not state:
        existing_unit = subprocess.run(['systemctl', 'cat', 'pm2-root'], capture_output=True, text=True)
        if existing_unit.returncode == 0 and (str(node_dir) not in existing_unit.stdout or 'PM2_HOME=/root/.pm2' not in existing_unit.stdout):
            raise InstallError('已有 PM2 开机服务使用其他 Node/PM2_HOME，请先统一运行环境')
        if apps and panel and Path('/usr/bin/node').resolve() != node_dir / 'bin/node':
            raise InstallError('已有 PM2 应用与所选面板默认 Node 不一致，请先统一运行环境')
    for target in (root, music):
        if shutil.disk_usage(parent_existing(target)).free < 6 * 1024**3 and not (state and state.get('complete')):
            raise InstallError('可用硬盘不足 6 GiB，请先释放空间')
    memory = dict(re.findall(r'^(MemTotal|SwapTotal):\s+(\d+)', Path('/proc/meminfo').read_text(), re.M))
    if sum(map(int, memory.values())) < 2 * 1024**2:
        raise InstallError('内存与 swap 合计需要至少 2 GiB；请在面板增加 swap 后重试')
    if state and state.get('complete'):
        health(args.port, '/api/health/deploy', attempts=3)
        health(args.music_port, attempts=3)
        print('已安装且两个服务正常。版本更新请使用后台「同步 GitHub」。')
        return
    if args.https:
        try:
            socket.getaddrinfo(domain, 80)
        except socket.gaierror:
            raise InstallError('域名尚未解析，无法申请 HTTPS 证书；请先设置 DNS 后重试')
    print(f'安装计划：{"宝塔/aaPanel" if panel else "普通 Linux"}，Node {node_dir.name}，PM2 /root/.pm2\n博客：{root} → 127.0.0.1:{args.port}\n音乐：{music} → 127.0.0.1:{args.music_port}\n域名：{domain}，HTTPS：{args.https}\n自动安装编译工具、依赖和 PM2，配置 Nginx 与开机启动。')
    if args.check:
        print('预检查通过；没有修改系统。')
        return
    if not args.yes and prompt('开始安装？输入 yes', 'no') != 'yes':
        raise InstallError('已取消')
    if args.https and not args.accept_acme_terms:
        if args.yes or prompt('同意 Let’s Encrypt 服务条款 https://letsencrypt.org/repository/ ？输入 yes', 'no') != 'yes':
            raise InstallError('HTTPS 安装需要同意 ACME 服务条款；可用 --accept-acme-terms')
    if not state:
        state = {'format': 1, 'root': str(root), 'music': str(music), 'domain': domain, 'port': args.port,
                 'music_port': args.music_port, 'https': args.https, 'node': str(node_dir), 'panel': panel, 'steps': []}
        # Clone to a sibling first; an interrupted clone never becomes an owned website.
        root.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.yezi-clone-', dir=root.parent) as temp:
            checkout = Path(temp) / 'source'
            run(['git', 'clone', '--no-local', args.source, checkout])
            run(['git', '-C', checkout, 'checkout', '-B', 'main'])
            run(['git', '-C', checkout, 'remote', 'set-url', 'origin', REPOSITORY])
            run(['git', '-C', checkout, 'update-ref', 'refs/remotes/origin/main', 'HEAD'])
            run(['git', '-C', checkout, 'branch', '--set-upstream-to=origin/main', 'main'])
            atomic_write(checkout / RECEIPT, json.dumps(state))
            if root.exists():
                root.rmdir()  # Only an empty directory passed preflight.
            checkout.rename(root)
        atomic_write(root / '.git/info/exclude', (root / '.git/info/exclude').read_text() + '\n' + RECEIPT + '\n' + ECOSYSTEM + '\n')
    def step(name, task, always=False):
        if always or name not in state['steps']:
            print(f'\n[安装] {name}', flush=True)
            task()
            if name not in state['steps']:
                state['steps'].append(name)
            atomic_write(root / RECEIPT, json.dumps(state))
    packages = ['curl', 'git', 'ca-certificates', 'xz-utils', 'python3', 'build-essential', 'pkg-config', 'iproute2']
    if not panel:
        packages.append('nginx')
    if args.https:
        packages.append('certbot')
    step('系统组件', lambda: (run(['apt-get', 'update'], env=env), run(['apt-get', 'install', '-y', '--no-install-recommends'] + packages, env=env)))
    step('Node', lambda: install_node(node_dir, env))
    def prepare_pm2():
        if not (node_dir / 'bin/pm2').exists():
            run([node_dir / 'bin/npm', 'install', '--global', f'pm2@{PM2_VERSION}'], env=env)
        # Detect mismatch before issuing mutating PM2 commands.
        pm2_apps(node_dir, env)
    step('PM2', prepare_pm2)
    if panel:
        step('面板默认 Node', lambda: panel_call('default', {'version': node_dir.name, 'node': str(node_dir / 'bin/node')}))
    def configure():
        if not (root / '.env.local').exists():
            atomic_write(root / '.env.local', environment_file(root, domain, args.port, args.music_port, node_dir, args.https))
        (root / 'data').mkdir(mode=0o700, exist_ok=True)
        music.mkdir(mode=0o755, parents=True, exist_ok=True)
        atomic_write(music / RECEIPT, json.dumps({'root': str(root)}))
        atomic_write(music / 'package.json', json.dumps({'name': 'yezi-music-service', 'private': True, 'version': '1.0.0',
            'scripts': {'start': 'node start.mjs'}, 'dependencies': {'@yakult-green-tea/qq-music-api': MUSIC_VERSION}}, indent=2))
        atomic_write(music / 'start.mjs', (root / 'scripts/start-local-qq-music-api.mjs').read_text())
        atomic_write(root / ECOSYSTEM, ecosystem(NAMES[0], root, node_dir, args.port, True))
        atomic_write(music / ECOSYSTEM, ecosystem(NAMES[1], music, node_dir, args.music_port))
    step('网站配置', configure)
    step('博客依赖', lambda: run([node_dir / 'bin/npm', 'ci', '--no-audit', '--no-fund'], cwd=root, env=env))
    step('音乐依赖', lambda: run([node_dir / 'bin/npm', 'install', '--omit=dev', '--no-audit', '--no-fund'], cwd=music, env=env))
    step('构建博客', lambda: run([node_dir / 'bin/npm', 'run', 'build'], cwd=root, env=env))
    def start():
        running = {app['name'] for app in pm2_apps(node_dir, env)
                   if app.get('pid') and app.get('pm2_env', {}).get('status') == 'online'}
        for name, directory, port in ((NAMES[1], music, args.music_port), (NAMES[0], root, args.port)):
            if panel:
                panel_call('register', {'name': name, 'root': str(directory), 'port': port, 'version': node_dir.name,
                    'config': str(directory / ECOSYSTEM), 'domains': [domain] if name == NAMES[0] else []})
            if name not in running:
                run([node_dir / 'bin/pm2', 'start', directory / ECOSYSTEM], env=env)
        health(args.port, '/api/health/deploy')
        health(args.music_port)
        commit = run(['git', '-C', root, 'rev-parse', 'HEAD'], capture=True)
        atomic_write(root / 'data/deploy-commit', commit + '\n')
    step('启动服务', start, always=True)
    acme = Path('/var/lib/yezi-acme')
    def proxy():
        acme.mkdir(mode=0o755, parents=True, exist_ok=True)
        previous = conf.read_text() if conf.exists() else None
        atomic_write(conf, nginx_config(domain, args.port, acme), 0o644)
        try:
            run([nginx, '-t'])
        except Exception:
            if previous is None:
                conf.unlink()
            else:
                atomic_write(conf, previous, 0o644)
            raise
        run(['systemctl', 'enable', '--now', 'nginx'])
        run([nginx, '-s', 'reload'])
    step('域名反向代理', proxy)
    def certificate():
        run(['certbot', 'certonly', '--webroot', '-w', acme, '-d', domain, '--cert-name', domain,
             '--non-interactive', '--agree-tos', '--register-unsafely-without-email', '--keep-until-expiring'])
        previous = conf.read_text()
        atomic_write(conf, nginx_config(domain, args.port, acme, True), 0o644)
        try:
            run([nginx, '-t'])
        except Exception:
            atomic_write(conf, previous, 0o644)
            raise
        run([nginx, '-s', 'reload'])
        hook = Path('/etc/letsencrypt/renewal-hooks/deploy/yezi-nginx.sh')
        atomic_write(hook, f'#!/bin/sh\n{nginx} -t && {nginx} -s reload\n', 0o700)
        run(['systemctl', 'enable', '--now', 'certbot.timer'])
    if args.https:
        step('HTTPS 证书', certificate)
    def startup():
        run([node_dir / 'bin/pm2', 'save'], env=env)
        # PM2's root unit may manage other projects too. Never replace an existing unit.
        existing = subprocess.run(['systemctl', 'cat', 'pm2-root'], capture_output=True, text=True)
        if existing.returncode:
            run([node_dir / 'bin/pm2', 'startup', 'systemd', '-u', 'root', '--hp', '/root'], env=env)
        elif str(node_dir) not in existing.stdout or 'PM2_HOME=/root/.pm2' not in existing.stdout:
            raise InstallError('已有 PM2 开机服务使用其他 Node/PM2_HOME，请统一后重复安装命令')
        run(['systemctl', 'enable', 'pm2-root'])
    step('开机启动', startup)
    health(args.port, '/api/health/deploy')
    health(args.music_port)
    if panel and not all(panel_call('status', {}).values()):
        raise InstallError('服务已运行，但面板状态校验未通过，请检查面板 PM2 版本')
    # Verify reverse proxy routing locally, independent of whether DNS has propagated.
    scheme = 'https' if args.https else 'http'
    response = run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--max-time', '15', '--resolve',
         f'{domain}:{443 if args.https else 80}:127.0.0.1', f'{scheme}://{domain}/api/health/deploy'], capture=True)
    commit = run(['git', '-C', root, 'rev-parse', 'HEAD'], capture=True)
    try:
        report = json.loads(response)
        healthy = report.get('status') == 'ok' and report.get('commit') == commit
    except ValueError:
        healthy = False
    if not healthy:
        raise InstallError('域名反向代理返回的版本与本次安装不一致，请检查域名映射')
    state['complete'] = True
    atomic_write(root / RECEIPT, json.dumps(state))
    print(f'\n安装完成：{scheme}://{domain}/admin\n后台 → 设置 → 备份与恢复：上传本地备份，或填写 WebDAV 与旧站恢复密钥。\n初始管理员密码在 {root}/.env.local 的 ADMIN_PASSWORD。\n面板项目：yezi-blog、api_music_yezi_me。音乐端口仅本机可访问。')
    show_login_password(root)
    if not args.https:
        print('当前使用 HTTP；正式使用前请在面板配置 HTTPS，并更新网站地址、SESSION_COOKIE_SECURE=true、DEPLOY_DIRECT_HTTP=false 后重启博客。')


def main():
    args = parser().parse_args()
    # Host-wide lock prevents two installs from passing the same empty-directory check.
    preflight_os()
    with open('/run/lock/yezi-install.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InstallError('另一个安装器正在运行')
        install(args)


if __name__ == '__main__':
    try:
        main()
    except (InstallError, subprocess.TimeoutExpired) as error:
        print('\n安装未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
