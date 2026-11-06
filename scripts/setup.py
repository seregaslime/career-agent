"""Install project-local hooks without replacing an unrelated hook setup."""
import subprocess
import sys

current = subprocess.run(
    ['git', 'config', '--local', '--get', 'core.hooksPath'],
    capture_output=True, text=True,
)
if current.stdout.strip() not in ('', '.githooks'):
    sys.exit('Existing core.hooksPath detected; integrate hooks manually, do not overwrite.')
subprocess.run(['git', 'config', '--local', 'core.hooksPath', '.githooks'], check=True)
print('Installed .githooks. Every push requires checks and review of the pushed SHA.')
