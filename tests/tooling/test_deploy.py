import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).resolve().parents[2] / 'scripts/deploy_render.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def test_deploys_exact_tested_commit(self):
        sha = 'a' * 40
        with patch.dict(os.environ, {'RENDER_SERVICE_ID': 'srv-test', 'GITHUB_SHA': sha}):
            with patch.object(deploy, 'request', side_effect=[{'id': 'dep-test'}, {'status': 'live', 'commit': {'id': sha}}]) as api:
                deploy.main()
                self.assertEqual(api.call_args_list[0].args[1], {'commitId': sha})

    def test_wrong_live_commit_fails(self):
        with patch.dict(os.environ, {'RENDER_SERVICE_ID': 'srv-test', 'GITHUB_SHA': 'a' * 40}):
            with patch.object(deploy, 'request', side_effect=[{'id': 'dep-test'}, {'status': 'live', 'commit': {'id': 'b' * 40}}]):
                with self.assertRaises(SystemExit):
                    deploy.main()

    def test_build_failure_fails_pipeline(self):
        with patch.dict(os.environ, {'RENDER_SERVICE_ID': 'srv-test', 'GITHUB_SHA': 'a' * 40}):
            with patch.object(deploy, 'request', side_effect=[{'id': 'dep-test'}, {'status': 'build_failed'}]):
                with self.assertRaises(SystemExit):
                    deploy.main()
