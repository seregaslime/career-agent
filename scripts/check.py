"""Single check entry point for local hooks and CI; standard library only."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def document_errors(root, files):
    errors = []
    for relative in files:
        path = root / relative
        if not path.is_file() or path.suffix != '.md':
            continue
        content = path.read_text(encoding='utf-8')
        for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', content):
            target = target.strip().strip('<>')
            if urlsplit(target).scheme or target.startswith('#'):
                continue
            destination = unquote(target.split('#', 1)[0])
            if destination.startswith('/') or not (path.parent / destination).exists():
                errors.append(f'{relative}: broken or nonportable link: {target}')
    return errors


def main():
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    errors = document_errors(ROOT, files)
    for name in files:
        path = Path(name)
        if name and (path.name == '.env' or
                     (path.name.startswith('.env.') and path.name != '.env.example') or
                     path.suffix in ('.pem', '.key')):
            errors.append('Forbidden tracked secret file: ' + name)
    if errors:
        sys.exit('\n'.join(errors))
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--cached', '--check'], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/tooling', '-v'], cwd=ROOT, check=True)
    backend = ROOT / 'backend'
    python = backend / '.venv' / 'bin' / 'python'
    if backend.exists():
        if not python.exists():
            sys.exit('Run uv sync --project backend --frozen first.')
        for args in [('ruff', 'check', '.'), ('ruff', 'format', '--check', '.'), ('mypy', 'app'), ('pytest',)]:
            subprocess.run([str(python), '-m', *args], cwd=backend, check=True)
    if (ROOT / 'frontend').exists():
        for task in ('lint', 'typecheck', 'test', 'build'):
            subprocess.run(['npm', 'run', task], cwd=ROOT / 'frontend', check=True)
    print('Repository and application checks passed.')


if __name__ == '__main__':
    main()
