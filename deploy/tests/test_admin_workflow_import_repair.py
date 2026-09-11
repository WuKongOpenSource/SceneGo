from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import pytest


def _assert_versioned_admin_assets(html):
    class Assets(HTMLParser):
        def __init__(self):
            super().__init__()
            self.urls = {"style.css": [], "app.js": []}

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "link" and "stylesheet" in attrs.get("rel", "").split():
                name, url = "style.css", attrs.get("href", "")
            elif tag == "script":
                name, url = "app.js", attrs.get("src", "")
            else:
                return
            parsed = urlsplit(url)
            if parsed.path == name:
                assert not parsed.scheme and not parsed.netloc and not parsed.fragment
                self.urls[name].append(parsed)

    assets = Assets()
    assets.feed(html)
    versions = []
    for urls in assets.urls.values():
        assert len(urls) == 1, "Load each admin entry asset exactly once."
        values = parse_qs(urls[0].query, keep_blank_values=True).get("v", [])
        assert len(values) == 1 and values[0].strip(), "Admin assets need a cache version."
        versions.append(values[0])
    assert versions[0] == versions[1], "Admin script and stylesheet must share a release."


@pytest.mark.parametrize("version", ["current-release", "next-release"])
def test_admin_asset_check_accepts_new_release_versions(version):
    _assert_versioned_admin_assets(
        f'<link rel="stylesheet" href="style.css?v={version}">'
        f'<script src="app.js?v={version}"></script>'
    )


@pytest.mark.parametrize("html", [
    '<link rel="stylesheet" href="style.css"><script src="app.js?v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><script src="app.js"></script>',
    '<link rel="stylesheet" href="style.css?v="><script src="app.js?v="></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><script src="app.js?v=r2"></script>',
    '<link rel="stylesheet" href="style.css?v=r1&v=r1"><script src="app.js?v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><script src="app.js?v=r1&v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1">',
    '<script src="app.js?v=r1"></script>',
    '<!-- <link rel="stylesheet" href="style.css?v=r1"> --><script src="app.js?v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><script src="other.js?v=r1"></script>',
    '<link rel="icon" href="style.css?v=r1"><script src="app.js?v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><link rel="stylesheet" href="style.css?v=r1"><script src="app.js?v=r1"></script>',
    '<link rel="stylesheet" href="style.css?v=r1"><script src="app.js?v=r1"></script><script src="app.js?v=r1"></script>',
])
def test_admin_asset_check_rejects_missing_stale_or_duplicate_assets(html):
    with pytest.raises(AssertionError):
        _assert_versioned_admin_assets(html)
