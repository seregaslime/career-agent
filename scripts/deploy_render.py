"""Deploy the tested GitHub SHA and wait for Render to report live."""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request


def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        'https://api.render.com/v1/' + path, data=data,
        headers={'Authorization': 'Bearer ' + os.environ['RENDER_API_KEY'],
                 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        sys.exit(f'Render API returned HTTP {exc.code}; inspect Render dashboard.')


def main():
    service = os.environ['RENDER_SERVICE_ID']
    sha = os.environ['GITHUB_SHA']
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        sys.exit('Invalid commit SHA')
    deploy = request(f'services/{service}/deploys', {'commitId': sha})
    deploy_id = deploy['id']
    for _ in range(90):
        current = request(f'services/{service}/deploys/{deploy_id}')
        status = current['status']
        print('Render deploy:', status, flush=True)
        if status == 'live':
            if current.get('commit', {}).get('id') != sha:
                sys.exit('Render deployed a different commit')
            return
        if status in ('build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'):
            sys.exit('Render deployment failed; inspect logs in dashboard.')
        time.sleep(10)
    sys.exit('Render deploy timed out; deployment may still be running.')


if __name__ == '__main__':
    main()
