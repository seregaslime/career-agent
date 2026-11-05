"""Local review attestations bound to exact commit IDs; not independent review."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ZERO = '0' * 40


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def record_path(sha):
    return Path(git('rev-parse', '--git-path', 'career-reviews')) / (sha + '.json')


def verify_record(sha):
    try:
        data = json.loads(record_path(sha).read_text())
        return data['sha'] == sha and bool(data['reviewer'].strip()) and bool(data['summary'].strip())
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def verify_push(lines):
    for line in lines:
        local_ref, sha, remote_ref, _remote_sha = line.split()
        if sha == ZERO:  # deleting a ref sends no new code
            continue
        if not local_ref.startswith('refs/heads/') or not remote_ref.startswith('refs/heads/'):
            raise ValueError('Only branch pushes are supported by this review gate.')
        if remote_ref == 'refs/heads/main':
            raise ValueError('Push a feature branch and open a PR; direct push to main is blocked.')
        if not verify_record(sha):
            raise ValueError('Missing review for pushed commit ' + sha + '. Run scripts/review.py record after review.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    record = commands.add_parser('record')
    record.add_argument('--reviewer', required=True)
    record.add_argument('--summary', required=True)
    commands.add_parser('verify-push')
    args = parser.parse_args()
    if args.command == 'record':
        if git('status', '--porcelain'):
            sys.exit('Commit changes before recording review; working tree must be clean.')
        if not args.reviewer.strip() or not args.summary.strip():
            sys.exit('Reviewer and summary must not be blank.')
        sha = git('rev-parse', 'HEAD')
        path = record_path(sha)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(dict(sha=sha, reviewer=args.reviewer, summary=args.summary,
                                       recorded_at=datetime.now(timezone.utc).isoformat()), indent=2) + '\n')
        print('Review recorded for ' + sha)
    else:
        if git('status', '--porcelain'):
            sys.exit('Push requires a clean working tree so checks match the reviewed commit.')
        lines = list(sys.stdin)
        head = git('rev-parse', 'HEAD')
        for line in lines:
            sha = line.split()[1]
            if sha != ZERO and sha != head:
                sys.exit('Push only the checked-out reviewed commit; switch branches first.')
        try:
            verify_push(lines)
        except ValueError as exc:
            sys.exit(str(exc))
        print('Review gate passed.')


if __name__ == '__main__':
    main()
