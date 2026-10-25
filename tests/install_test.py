"""Run with python3 -m unittest discover -s tests -p install_test.py."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location('yezi_install', Path(__file__).resolve().parents[1] / 'scripts/install/install.py')
install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install)
PANEL_SPEC = importlib.util.spec_from_file_location('yezi_panel', Path(__file__).resolve().parents[1] / 'scripts/install/panel.py')
panel = importlib.util.module_from_spec(PANEL_SPEC)
PANEL_SPEC.loader.exec_module(panel)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'blog'
        self.music = self.base / 'music'

    def receipt(self):
        self.root.mkdir()
        state = {'format': 1, 'root': str(self.root), 'music': str(self.music), 'domain': 'test.example',
                 'port': 3030, 'music_port': 3200, 'https': False, 'steps': []}
        install.atomic_write(self.root / install.RECEIPT, json.dumps(state))
        return state

    def read(self):
        return install.read_receipt(self.root, self.music, 'test.example', 3030, 3200, False)

    def test_domain_and_path_cannot_inject_panel_shell_or_nginx(self):
        for value in ('example.com;id', 'example.com\nroot /;', 'https://example.com', '../x', 'a.*.com', 'a_1.com', 'a..com'):
            with self.subTest(value=value), self.assertRaises(install.InstallError):
                install.domain_name(value)
        self.assertEqual(install.domain_name('Blog.Example.com'), 'blog.example.com')
        for value in ('/www/a b/c', '/www/../etc', '/etc', '/tmp/x/$(id)'):
            with self.subTest(value=value), self.assertRaises(install.InstallError):
                install.safe_directory(value)
        target = self.base / 'link'
        target.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(install.InstallError):
            install.safe_directory(str(target / 'site'))

    def test_refuses_any_existing_content_without_receipt(self):
        self.root.mkdir()
        (self.root / '.env.local').write_text('do-not-overwrite')
        with self.assertRaises(install.InstallError):
            self.read()
        self.assertEqual((self.root / '.env.local').read_text(), 'do-not-overwrite')

    def test_resume_requires_matching_parameters_and_music_ownership(self):
        self.receipt()
        self.assertIsNotNone(self.read())
        with self.assertRaises(install.InstallError):
            install.read_receipt(self.root, self.music, 'other.example', 3030, 3200, False)
        self.music.mkdir()
        (self.music / 'existing.js').touch()
        with self.assertRaises(install.InstallError):
            self.read()
        install.atomic_write(self.music / install.RECEIPT, json.dumps({'root': str(self.root)}))
        self.assertIsNotNone(self.read())

    def test_overlapping_directories_rejected(self):
        for a, b in ((self.root, self.root), (self.root, self.root / 'music'), (self.music / 'blog', self.music)):
            with self.assertRaises(install.InstallError):
                install.validate_locations(a, b)

    def test_private_write_and_symlink_refusal(self):
        target = self.base / '.env.local'
        install.atomic_write(target, 'secret')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        link = self.base / 'link'
        link.symlink_to(target)
        with self.assertRaises(install.InstallError):
            install.atomic_write(link, 'replacement')
        self.assertEqual(target.read_text(), 'secret')

    def test_unique_secrets_and_current_machine_paths(self):
        node = Path('/www/server/nodejs/v22.23.3')
        first = dict(line.split('=', 1) for line in install.environment_file(self.root, 'test.example', 3031, 3201, node, True).splitlines())
        second = dict(line.split('=', 1) for line in install.environment_file(self.root, 'test.example', 3031, 3201, node, True).splitlines())
        for key in ('ADMIN_PASSWORD', 'DATA_BACKUP_KEY', 'QQ_MUSIC_SIGNING_KEY'):
            self.assertNotEqual(first[key], second[key])
        self.assertEqual(first['BLOG_DB_PATH'], str(self.root / 'data/blog.db'))
        self.assertEqual(first['PM2_HOME'], '/root/.pm2')
        self.assertEqual(first['DEPLOY_DIRECT_HTTP'], 'false')
        self.assertEqual(first['SESSION_COOKIE_SECURE'], 'true')
        self.assertEqual(first['QQ_MUSIC_API_URL'], 'http://127.0.0.1:3201')

    def test_ecosystem_keeps_secrets_out_of_pm2_and_binds_loopback(self):
        text = install.ecosystem('yezi-blog', self.root, Path('/opt/node'), 3030, True)
        self.assertIn('"HOSTNAME": "127.0.0.1"', text)
        self.assertIn('name: "yezi-blog",', text)
        self.assertNotIn('ADMIN_PASSWORD', text)
        self.assertNotIn('APNS_', text)
        self.assertIn('start-standalone.mjs', text)

    def test_proxy_never_serves_repo_and_overwrites_forwarded_headers(self):
        text = install.nginx_config('test.example', 3030, '/var/lib/yezi-acme')
        self.assertNotIn('/www/wwwroot', text)
        self.assertIn('proxy_set_header X-Forwarded-For $remote_addr;', text)
        self.assertIn('client_max_body_size 1024m', text)
        tls = install.nginx_config('test.example', 3030, '/var/lib/yezi-acme', True)
        self.assertIn('listen 443 ssl;', tls)
        self.assertIn('location ^~ /.well-known/acme-challenge/', tls)
        self.assertIn('return 301 https://test.example$request_uri;', tls)

    def test_existing_nginx_domain_is_rejected_before_install(self):
        result = SimpleNamespace(returncode=0, stdout='server_name other.example test.example; # site')
        with patch.object(install.Path, 'exists', return_value=True), patch.object(install.subprocess, 'run', return_value=result):
            with self.assertRaises(install.InstallError):
                install.check_nginx_domain('/usr/sbin/nginx', 'test.example')
            install.check_nginx_domain('/usr/sbin/nginx', 'new.example')

    def test_resume_allows_only_its_own_nginx_file(self):
        config = self.base / 'owned.conf'
        result = SimpleNamespace(returncode=0, stdout=f'# configuration file {config}:\nserver_name test.example;\n')
        with patch.object(install.Path, 'exists', return_value=True), patch.object(install.subprocess, 'run', return_value=result):
            install.check_nginx_domain('/usr/sbin/nginx', 'test.example', config)
            result.stdout += '# configuration file /etc/nginx/other.conf:\nserver_name test.example;\n'
            with self.assertRaises(install.InstallError):
                install.check_nginx_domain('/usr/sbin/nginx', 'test.example', config)

    def test_health_rejects_successful_http_with_unhealthy_body(self):
        response = BytesIO(b'{"status":"error"}')
        response.status = 200
        with patch.object(install.urllib.request.OpenerDirector, 'open', return_value=response), patch.object(install.time, 'sleep'):
            with self.assertRaises(install.InstallError):
                install.health(3030, '/api/health/deploy', attempts=1)

    def test_process_environment_does_not_inherit_shell_credentials(self):
        with patch.dict(os.environ, {'APNS_PRIVATE_KEY': 'secret', 'BLOG_DB_PATH': '/old/blog.db', 'PM2_HOME': '/home/www/.pm2'}):
            env = install.command_environment(Path('/opt/node'))
        self.assertNotIn('APNS_PRIVATE_KEY', env)
        self.assertNotIn('BLOG_DB_PATH', env)
        self.assertEqual(env['PM2_HOME'], '/root/.pm2')

    def test_collision_never_adopts_same_named_process(self):
        apps = [{'name': 'yezi-blog', 'pid': 42, 'pm2_env': {'pm_cwd': str(self.root)}}]
        with self.assertRaises(install.InstallError):
            install.check_services(apps, self.root, self.music, False)
        install.check_services(apps, self.root, self.music, True)
        apps[0]['pm2_env']['pm_cwd'] = '/other/site'
        with self.assertRaises(install.InstallError):
            install.check_services(apps, self.root, self.music, True)

    def test_port_collision_requires_owned_pid(self):
        output = 'State Recv-Q Send-Q Local Peer Process\nLISTEN 0 511 127.0.0.1:3030 0.0.0.0:* users:(("node",pid=99,fd=1))'
        with patch.object(install.shutil, 'which', return_value='/usr/bin/ss'), patch.object(install, 'run', return_value=output):
            with self.assertRaises(install.InstallError):
                install.check_ports([3030], [])
            install.check_ports([3030], [{'name': 'yezi-blog', 'pid': 99}])

    def test_shell_help_does_not_install(self):
        result = install.run(['bash', str(Path(__file__).resolve().parents[1] / 'scripts/install.sh'), '--help'], capture=True)
        self.assertIn('宝塔/aaPanel', result)

    def test_panel_error_does_not_echo_environment_or_continue(self):
        with self.assertRaises(RuntimeError) as result:
            panel.Messages().send(json.dumps({'status': False, 'code': 2, 'msg': 'secret=not-for-logs'}))
        self.assertNotIn('not-for-logs', str(result.exception))

    def test_panel_refuses_existing_foreign_project(self):
        model = SimpleNamespace(get_project_find=lambda name: {'path': '/other/site', 'project_config': {'pm2_name': name}})
        with patch.object(panel, 'load_panel', return_value=(None, None, lambda: model, None)):
            with self.assertRaises(RuntimeError):
                panel.execute('register', {'name': 'yezi-blog', 'root': str(self.root)})

    def test_panel_retries_do_not_duplicate_owned_project(self):
        model = SimpleNamespace(get_project_find=lambda name: {'path': str(self.root), 'project_config': {'pm2_name': name}})
        with patch.object(panel, 'load_panel', return_value=(None, None, lambda: model, None)):
            self.assertEqual(panel.execute('register', {'name': 'yezi-blog', 'root': str(self.root)}), {'ok': True})


if __name__ == '__main__':
    unittest.main()
