import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


def test_release_acceptance_and_csv_benchmark():
    root = Path(__file__).parents[1]
    result = subprocess.run(
        ["node", "scripts/check-web-acceptance.mjs"],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_static_html_asset_paths_exist():
    web = Path(__file__).parents[1] / "web"

    class Links(HTMLParser):
        def handle_starttag(self, tag, attrs):
            for key, value in attrs:
                if key not in {"href", "src"} or not value:
                    continue
                url = urlsplit(value)
                if url.scheme or url.netloc or not url.path:
                    continue
                target = web / url.path.lstrip("/")
                assert target.is_file(), value

    for page in web.glob("*.html"):
        Links().feed(page.read_text())
