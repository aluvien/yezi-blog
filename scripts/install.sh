#!/usr/bin/env bash
# Download a complete checkout before executing the installer. Prompts use /dev/tty,
# so this entry point also works when its input comes from curl.
set -euo pipefail

main() {
  if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
    echo '叶子博客安装：sudo bash scripts/install.sh [--domain example.com] [--https --accept-acme-terms] [--yes]'
    echo '自动识别宝塔/aaPanel；支持 Debian 11+、Ubuntu 22.04+。目录默认 /www/wwwroot/<域名>。'
    echo '仅用于全新安装；已完成安装时重复执行只检查服务。--check 仅检查环境。'
    return
  fi
  [[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo '请在 Linux 服务器使用 root 或 sudo 执行。' >&2; return 1; }
  command -v apt-get >/dev/null || { echo '目前支持 Debian / Ubuntu（包括其上的宝塔、aaPanel）。' >&2; return 1; }
  if ! command -v git >/dev/null || ! command -v python3 >/dev/null || [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git python3 ca-certificates
  fi
  YEZI_INSTALL_STAGE=$(mktemp -d /tmp/yezi-installer.XXXXXXXX)
  trap 'rm -rf -- "$YEZI_INSTALL_STAGE"' EXIT
  git clone --depth 1 --branch main https://github.com/aluvien/yezi-blog.git "$YEZI_INSTALL_STAGE/source"
  python3 "$YEZI_INSTALL_STAGE/source/scripts/install/install.py" --source "$YEZI_INSTALL_STAGE/source" "$@"
}

main "$@"
