"""Read-only documentation coverage, link and asset regression checks."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('help_builder', DEPLOY / 'scripts/build_help_catalog.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def catalog():
    return json.loads(builder.OUT.read_text(encoding='utf-8'))


def without_code(body):
    result, fence = [], ''
    for line in body.splitlines():
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            if not fence:
                fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = ''
            continue
        if not fence:
            result.append(line)
    return '\n'.join(result)


def test_catalog_is_reproducible_and_covers_every_source_document():
    data = catalog()
    assert data == builder.build_catalog()
    provenance = json.loads((builder.SOURCES / 'provenance.json').read_text(encoding='utf-8'))
    expected = {item['path'] for item in provenance['files'] if item['path'].endswith('.md')}
    assert {item['sourcePath'] for item in data['documents'] if 'sourcePath' in item} == expected
    assert len(expected) == 43
    assert len([item for item in data['documents'] if item['category'] == 'manual']) == 16
    assert len({item['id'] for item in data['documents']}) == len(data['documents']) == 62
    assert all(re.search('[\u4e00-\u9fff]', item['title']) for item in data['documents'])
    assert len(list((builder.HELP / 'translations').rglob('*.md'))) == 21


def test_all_manual_and_reference_images_are_local_present_and_used():
    data = catalog()
    urls = set(re.findall(r'!\[[^]]*\]\(([^)]+)\)', '\n'.join(item['body'] for item in data['documents'])))
    assert len([url for url in urls if '/manual-' in url]) == 54
    assert len([url for url in urls if '/reference-' in url]) == 18
    for url in urls:
        assert url.startswith('/assets/help/media/') and '..' not in url
        assert (builder.ROOT / 'public' / url.lstrip('/')).is_file()
    assert {p.name for p in (builder.ROOT / 'public/assets/help/media').iterdir()} == {url.rsplit('/', 1)[1] for url in urls}


def test_internal_document_links_and_fragments_have_targets():
    data = catalog()
    documents = {item['id']: item for item in data['documents']}
    for item in data['documents']:
        visible = without_code(item['body'])
        for target in re.findall(r'(?<!!)\[[^]]+\]\(([^)]+)\)', visible):
            assert target.startswith(('/', '#', 'https://', 'http://', 'mailto:')), (item['id'], target)
            if target.startswith('/tools/help/'):
                path, _, fragment = target.removeprefix('/tools/help/').partition('#')
                assert path in documents, (item['id'], target)
                if fragment:
                    dest = documents[path]
                    headings = re.findall(r'^#{1,6}\s+(.+)$', without_code(dest['body']), re.M)
                    assert fragment in {builder.heading_id(h) for h in [dest['title'], *headings]}, (item['id'], target)


def test_supplementary_sources_are_readable_not_executable():
    documents = {item['id']: item for item in catalog()['documents']}
    for file in (builder.SOURCES / 'attachments').rglob('*.txt'):
        article = documents['appendix-design' if 'design-standard' in str(file) else 'appendix-licenses']
        assert file.read_text(encoding='utf-8').strip() in article['body']
    for article in documents.values():
        assert '<script' not in without_code(article['body']).lower()
    public_files = list((builder.ROOT / 'public/assets/help').rglob('*'))
    assert not any(p.suffix in {'.html', '.js', '.mjs', '.docx'} for p in public_files)


def test_source_only_reads_and_deep_link_route_stays_in_existing_shell():
    app = (builder.ROOT / 'App.tsx').read_text(encoding='utf-8')
    frontend = (DEPLOY / 'routers/frontend_pages.py').read_text(encoding='utf-8')
    assert 'path="help/:documentId"' in app
    assert '@router.get("/tools/{path:path}")' in frontend
    service = (builder.HELP / 'helpContent.ts').read_text(encoding='utf-8')
    assert "'/assets/help/catalog.json'" in service
    assert '/api/' not in service and 'localStorage' not in service


def test_published_manual_redaction_is_documented():
    provenance = json.loads((builder.SOURCES / 'provenance.json').read_text(encoding='utf-8'))
    assert provenance['manual']['sha256'] == '33ee908a3acd5919de24a0216623cfd0e3142ca4cb55606048ffd04483133cf4'
    assert {item['id'] for item in provenance['manual']['media'] if item['redacted']} == {'rId54', 'rId58', 'rId60'}
    assert len(provenance['files']) == 82
