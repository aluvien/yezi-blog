#!/usr/bin/env python3
"""Adapter for the shared, modern BaoTa/aaPanel Node project API.

Runs in the panel's own Python, never writes its SQLite schema directly.
Only newly created, installer-owned projects are registered.
"""
import json
import os
from pathlib import Path
import sys


def load_panel():
    root = Path('/www/server/panel')
    os.chdir(root)
    sys.path[:0] = [str(root / 'class'), str(root)]
    import public
    import PluginLoader
    from mod.project.nodejs.pm2Mod import main as PM2
    from projectModel.nodejsModel import main as Projects
    return public, PluginLoader, PM2, Projects


class Messages:
    def send(self, message):
        value = json.loads(message)
        if value.get('status') is False or value.get('code') in (2, 5):
            # Panel errors may contain command environments. Do not echo them.
            raise RuntimeError('面板创建项目失败，请检查面板 Node 项目日志')

    def close(self):
        pass


def execute(action, spec):
    public, loader, PM2, Projects = load_panel()
    if action == 'probe':
        for name in ('create_project', 'get_project_find', 'get_project_stat'):
            if not hasattr(PM2, name):
                raise RuntimeError('面板缺少现代 PM2 项目接口，请更新面板的 Node 项目组件')
        if not Path('/www/server/panel/plugin/nodejs/nodejs_main.py').is_file():
            raise RuntimeError('请先在面板安装 Node.js 版本管理器，再执行同一命令')
        rows = []
        for name in ('yezi-blog', 'api_music_yezi_me'):
            item = public.M('sites').where('name=?', (name,)).find()
            if item:
                rows.append({'name': name, 'path': item['path']})
        occupied = public.M('domain').where('name=?', (spec['domain'],)).find()
        owner = public.M('sites').where('id=?', (occupied['pid'],)).find() if occupied else None
        default = loader.plugin_run('nodejs', 'get_default_env', None)
        return {'projects': rows, 'domain_used': bool(occupied), 'default': default,
                'domain_owner': {'name': owner['name'], 'path': owner['path']} if owner else None}
    if action == 'default':
        result = loader.plugin_run('nodejs', 'set_default_env', public.dict_obj({'version': spec['version']}))
        if not result or result.get('status') is False:
            raise RuntimeError('设置面板默认 Node 失败')
        if Path('/usr/bin/node').resolve() != Path(spec['node']).resolve():
            raise RuntimeError('面板默认 Node 校验失败')
        return {'ok': True}
    if action == 'register':
        model = PM2()
        existing = model.get_project_find(spec['name'])
        if existing:
            conf = existing.get('project_config', {})
            if existing['path'] != spec['root'] or conf.get('pm2_name') != spec['name']:
                raise RuntimeError('面板中已有同名的其他项目')
            return {'ok': True}
        args = public.dict_obj({
            'def_name': 'create_project', '_ws': Messages(),
            'project_type': 'pm2', 'project_name': spec['name'],
            'nodejs_version': spec['version'], 'project_cwd': spec['root'],
            'project_file': spec['config'], 'config_file': spec['config'],
            'config_body': Path(spec['config']).read_text(),
            'cluster': 1, 'max_memory_limit': 1024, 'watch': False,
            'pkg_manager': 'npm', 'not_install_pkg': True, 'run_user': 'root',
            'port': str(spec['port']), 'release_firewall': False, 'is_power_on': True,
            'bind_extranet': bool(spec['domains']), 'domains': spec['domains'],
            'project_ps': 'Yezi installer',
        })
        model.create_project(args)
        if not model.get_project_find(spec['name']):
            raise RuntimeError('面板未保存项目记录')
        return {'ok': True}
    if action == 'status':
        model = Projects()
        result = {}
        for name in ('yezi-blog', 'api_music_yezi_me'):
            state = model.get_project_stat(public.dict_obj({'project_name': name}))
            result[name] = bool(state and state.get('run'))
        return result
    raise ValueError('Unknown panel action')


if __name__ == '__main__':
    try:
        result = execute(sys.argv[1], json.load(sys.stdin))
        print('YEZI_RESULT=' + json.dumps(result))
    except Exception as error:
        print('YEZI_ERROR=' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
        sys.exit(1)
