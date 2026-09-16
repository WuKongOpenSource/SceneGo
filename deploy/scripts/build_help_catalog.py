"""Compile reviewed Chinese editorial sources into a read-only help catalog.

Only document data is produced; no HTML, executable scripts, account data or
runtime configuration is imported. Source provenance pins the public snapshot.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / 'new_html'
HELP = ROOT / 'help'
SOURCES = HELP / 'sources'
OUT = ROOT / 'public/assets/help/catalog.json'
CATEGORIES = [
    {'id': 'manual', 'title': '操作手册', 'description': '从登录到成片的完整图文教程'},
    {'id': 'features', 'title': '功能指南', 'description': '字幕、素材、专业画布与常见问题'},
    {'id': 'deployment', 'title': '开源部署', 'description': '安装、配置、模型接入与自行维护'},
    {'id': 'technical', 'title': '技术说明', 'description': '架构、运行约定与历史版本说明'},
    {'id': 'reference', 'title': '规范与许可', 'description': '品牌、设计参考、发行规范与第三方许可'},
]


def doc_id(path: str) -> str:
    if path == '自由创作操作手册.md':
        return 'canvas-guide'
    return 'doc-' + re.sub(r'[^a-z0-9]+', '-', path.lower().removesuffix('.md')).strip('-')


def heading_id(text: str) -> str:
    text = re.sub(r'[`*_]', '', text).lower()
    return 'help-' + re.sub(r'\s+', '-', ''.join(c for c in text if c.isalnum() or c in ' _-').strip())


def category_for(path: str) -> str:
    if path.startswith('open-source/third-party/') or any(word in path for word in ['branding', 'tab-navigation', 'repository-boundary', 'release-boundary', 'security-release', 'dependency-review']):
        return 'reference'
    if path.startswith('architecture/') or path.startswith('open-source/sync-') or path in {'admin-grouping.md', 'recharge-order-expiry.md', 'workflow-performance.md', 'platform-versioning.md'}:
        return 'technical'
    if path.startswith('open-source/') and not path.endswith('image-reference-errors.zh-CN.md') or path == 'self-hosted-slider-verification.md':
        return 'deployment'
    return 'features'


def title_and_body(text: str) -> tuple[str, str]:
    title, _, body = text.strip().partition('\n')
    title = title.lstrip('# ').strip()
    if not re.search('[\u4e00-\u9fff]', title):
        raise ValueError('Missing Chinese title: ' + title)
    return title, body.strip() + '\n'


def summary_of(body: str) -> str:
    for block in body.split('\n\n'):
        if block.strip() and not block.startswith(('#', '>', '!', '|', '```', '~~~')):
            plain = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', block)
            plain = re.sub(r'[`*_\n]', '', plain)
            return plain[:125] + ('…' if len(plain) > 125 else '')
    return '查看完整中文说明、适用范围和操作细节。'


def build_catalog() -> dict:
    provenance = json.loads((SOURCES / 'provenance.json').read_text(encoding='utf-8'))
    expected = {entry['path'].removeprefix('docs/'): entry for entry in provenance['files']}
    markdown_paths = {path for path in expected if path.endswith('.md')}
    actual_paths = {p.relative_to(SOURCES / 'repository').as_posix() for p in (SOURCES / 'repository').rglob('*.md')}
    if markdown_paths != actual_paths:
        raise ValueError('Public documentation coverage changed; review provenance and translations first')
    translated = {}
    anchors = {}
    for path in sorted(markdown_paths):
        original = (SOURCES / 'repository' / path).read_text(encoding='utf-8')
        translation = HELP / 'translations' / path
        text = translation.read_text(encoding='utf-8') if translation.exists() else original
        title_and_body(text)
        if not re.search('[\u4e00-\u9fff]', original.splitlines()[0]) and not translation.exists():
            raise ValueError('Missing translation: ' + path)
        translated[path] = text
        original_headings = re.findall(r'^#{1,6}\s+(.+)$', original, re.M)
        current_headings = re.findall(r'^#{1,6}\s+(.+)$', text, re.M)
        anchors[path] = {heading_id(a).removeprefix('help-'): heading_id(b) for a, b in zip(original_headings, current_headings)}

    def target_url(target: str, source: str) -> str:
        parsed = urlsplit(target)
        if parsed.scheme or target.startswith(('/', '#')):
            if target.startswith('#'):
                key = unquote(target[1:])
                return '#' + anchors.get(source, {}).get(key, heading_id(key))
            return target
        path = posixpath.normpath(posixpath.join(posixpath.dirname(source), unquote(parsed.path)))
        if path in markdown_paths:
            anchor = ''
            if parsed.fragment:
                key = unquote(parsed.fragment)
                anchor = '#' + anchors[path].get(key, heading_id(key))
            return '/tools/help/' + doc_id(path) + anchor
        if path in expected and path.endswith('.png'):
            return '/assets/help/media/reference-' + Path(path).stem + '.webp'
        if path in expected:
            return '/tools/help/appendix-design' if path.endswith('.js') else '/tools/help/appendix-licenses'
        # Code/config references remain pinned to the same public source revision.
        resolved = posixpath.normpath('docs/' + path)
        return f"{provenance['repository']}/blob/{provenance['revision']}/{quote(resolved, safe='/')}" + ('#' + parsed.fragment if parsed.fragment else '')

    def rewrite_links(text: str, source: str) -> str:
        result, fenced = [], False
        for line in text.splitlines():
            if re.match(r'^\s*(```|~~~)', line):
                fenced = not fenced
            if not fenced:
                line = re.sub(r'(?<!!)\[([^]]+)\]\(([^)\s]+)\)', lambda m: '[' + m[1] + '](' + target_url(m[2], source) + ')', line)
                line = re.sub(r'!\[([^]]*)\]\(([^)\s]+)\)', lambda m: '![' + m[1] + '](' + target_url(m[2], source) + ')', line)
            result.append(line)
        return '\n'.join(result) + '\n'

    documents = []
    guide = ROOT.parents[1] / 'docs/seedream-portrait-reference.zh-CN.md'
    title, body = title_and_body(guide.read_text(encoding='utf-8'))
    documents.append({'id': 'seedream-portrait-reference', 'title': title, 'category': 'features', 'summary': summary_of(body), 'body': body, 'source': '创剧功能指南 · 2026-09-16'})
    for file in sorted((SOURCES / 'manual').glob('*.md')):
        title, body = title_and_body(file.read_text(encoding='utf-8'))
        documents.append({'id': 'manual-' + file.stem, 'title': title, 'category': 'manual', 'summary': summary_of(body), 'body': body, 'source': '操作手册 · 2026-09-15 · V1.0'})
    for path, text in translated.items():
        title, body = title_and_body(text)
        if path == '自由创作操作手册.md':
            body = '> 版本提示：此文为 2026-07-03 的画布说明，现界面使用“专业画布”名称；部分入口和能力已演进。当前操作可对照[操作手册中的专业画布](/tools/help/manual-12)。开源版不附带私有本地执行服务。\n\n' + body
        if path == 'open-source/README.zh-CN.md':
            body = '> 登录方式补充：验证码登录可在验证成功后按需创建账号，不要求先设置密码，见[手机验证码登录与注册](/tools/help/doc-phone-code-login)。\n\n' + body
        documents.append({'id': doc_id(path), 'title': title, 'category': category_for(path), 'summary': summary_of(body), 'body': rewrite_links(body, path), 'source': 'SceneGo 开源文档 · 中文版', 'sourcePath': 'docs/' + path, 'sourceUrl': f"{provenance['repository']}/blob/{provenance['revision']}/docs/{quote(path, safe='/')}"})

    for name in ['design', 'licenses']:
        guide = (HELP / 'appendices' / (name + '.md')).read_text(encoding='utf-8')
        title, body = title_and_body(guide)
        if name == 'design':
            for path in sorted(expected):
                if path.endswith('.png'):
                    body += f'\n## 设计参考图 {Path(path).stem}\n\n![设计参考示意图](/assets/help/media/reference-{Path(path).stem}.webp)\n'
        for file in sorted((SOURCES / 'attachments').rglob('*.txt')):
            path = file.relative_to(SOURCES / 'attachments').as_posix().removesuffix('.txt')
            if (name == 'design') != path.startswith('design-standard/'):
                continue
            original = file.read_text(encoding='utf-8')
            kind = '脚本源码' if path.endswith('.js') else '结构化核验记录' if path.endswith('.json') else '许可原文'
            body += f'\n## {kind}：{Path(path).name}\n\n'
            if kind == '许可原文':
                body += '以下保留权利人原始许可及归属文字；中文导读不替代原文，也不更改许可条件。\n\n'
            else:
                body += '供查阅的原始技术附件。标识符、哈希、代码与证据字段不作翻译，页面不会执行这些内容。\n\n'
            fence = '`' * max(4, max((len(m[0]) for m in re.finditer(r'`+', original)), default=0) + 1)
            body += fence + ('javascript' if path.endswith('.js') else 'json' if path.endswith('.json') else 'text') + '\n' + original.rstrip() + '\n' + fence + '\n'
        documents.append({'id': 'appendix-' + name, 'title': title, 'category': 'reference', 'summary': summary_of(body), 'body': body, 'source': 'SceneGo 开源文档 · 中文导读与原始附件'})
    return {'version': 1, 'updatedAt': '2026-09-16', 'sourceRevision': provenance['revision'], 'categories': CATEGORIES, 'documents': documents}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify checked-in catalog matches editorial sources')
    args = parser.parse_args()
    catalog = build_catalog()
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding='utf-8') != text:
            raise SystemExit('Help catalog is stale. Run python deploy/scripts/build_help_catalog.py')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text, encoding='utf-8', newline='\n')
    print(f"Help catalog verified: {len(catalog['documents'])} articles; sha256={hashlib.sha256(text.encode()).hexdigest()}")


if __name__ == '__main__':
    main()
