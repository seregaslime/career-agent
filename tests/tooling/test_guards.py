"""Regression checks for the push gate and portable documentation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


review = load('review')
checks = load('check')
SHA = 'a' * 40


class ReviewGateTests(unittest.TestCase):
    def test_main_push_is_blocked_even_with_review(self):
        with patch.object(review, 'verify_record', return_value=True):
            with self.assertRaisesRegex(ValueError, 'direct push'):
                review.verify_push([f'refs/heads/work {SHA} refs/heads/main {review.ZERO}'])

    def test_unreviewed_tip_is_rejected(self):
        with patch.object(review, 'verify_record', return_value=False):
            with self.assertRaisesRegex(ValueError, 'Missing review'):
                review.verify_push([f'refs/heads/work {SHA} refs/heads/work {review.ZERO}'])

    def test_each_pushed_branch_is_checked(self):
        with patch.object(review, 'verify_record', side_effect=[True, False]):
            with self.assertRaisesRegex(ValueError, 'Missing review'):
                review.verify_push([f'refs/heads/a {SHA} refs/heads/a {review.ZERO}',
                                    f'refs/heads/b {SHA} refs/heads/b {review.ZERO}'])

    def test_reviewed_feature_tip_passes(self):
        with patch.object(review, 'verify_record', return_value=True):
            review.verify_push([f'refs/heads/work {SHA} refs/heads/work {review.ZERO}'])

    def test_head_refspec_passes_when_reviewed(self):
        with patch.object(review, 'verify_record', return_value=True):
            review.verify_push([f'HEAD {SHA} refs/heads/work {review.ZERO}'])

    def test_delete_does_not_need_review(self):
        review.verify_push([f'(delete) {review.ZERO} refs/heads/old {SHA}'])

    def test_review_must_match_sha_and_have_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'record.json'
            with patch.object(review, 'record_path', return_value=path):
                self.assertFalse(review.verify_record(SHA))
                path.write_text('{"sha":"wrong","reviewer":"tester","summary":"checked"}')
                self.assertFalse(review.verify_record(SHA))
                path.write_text('{"sha":"' + SHA + '","reviewer":"tester","summary":"checked"}')
                self.assertTrue(review.verify_record(SHA))
                path.write_text('not json')
                self.assertFalse(review.verify_record(SHA))


class DocumentTests(unittest.TestCase):
    def test_relative_links_resolve_from_document_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'docs').mkdir()
            (root / 'README.md').write_text('hello')
            (root / 'docs' / 'guide.md').write_text('[home](../README.md) [web](https://example.com)')
            self.assertEqual([], checks.document_errors(root, ['docs/guide.md']))
            (root / 'docs' / 'guide.md').write_text('[missing](absent.md)')
            self.assertEqual(1, len(checks.document_errors(root, ['docs/guide.md'])))


if __name__ == '__main__':
    unittest.main()
