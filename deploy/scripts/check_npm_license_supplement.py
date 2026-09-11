#!/usr/bin/env python3
"""Check scoped npm license evidence offline, without granting release approval.

Exact archive hashes and immutable-source observations are collected separately.
This gate detects accidental lock/evidence drift, not forged provenance, complete
native build reproducibility, or all license obligations of a binary bundle.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from pathlib import Path
import re
from urllib.parse import quote

try:
    from .check_npm_sbom import InventoryError, read_json, sri_hash
except ImportError:
    from check_npm_sbom import InventoryError, read_json, sri_hash


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = 'docs/open-source/third-party/'
MANIFEST = DIRECTORY + 'npm-license-supplement.json'
PROJECTS = ('deploy/new_html', 'studio')
SOURCES = {
    'esbuild': ('evanw/esbuild', 26, [('LICENSE.md', 'licenses/npm-esbuild-0.25.12.txt')]),
    'rollup': ('rollup/rollup', 25, [('LICENSE-CORE.md', 'licenses/npm-rollup-4.63.1-core.txt')]),
    'lzma': ('Brooooooklyn/lzma', 1, []),
    'dlv': ('developit/dlv', 1, []),
    'saxes': ('lddubeau/saxes', 1, [('LICENSE', 'licenses/npm-saxes-6.0.0.txt'),
                                  ('AUTHORS', 'licenses/npm-saxes-6.0.0-authors.txt')]),
    'stackback': ('defunctzombie/node-stackback', 1, []),
}


class EvidenceError(ValueError):
    """The evidence is incomplete or no longer corresponds to reviewed inputs."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvidenceError(message)


def digest(value, length=64) -> bool:
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{' + str(length) + '}', value) is not None


def copy_bytes(root: Path, record: dict, expected: str) -> bytes:
    require(record.get('path') == expected, 'Unreviewed evidence copy path')
    path = root / DIRECTORY / expected
    require(path.resolve().is_relative_to((root / DIRECTORY).resolve()), 'External evidence copy')
    require(path.is_file() and path.stat().st_size <= 100_000, 'Missing or oversized evidence copy')
    data = path.read_bytes()
    require(digest(record.get('sha256')) and hashlib.sha256(data).hexdigest() == record['sha256'],
            'Changed evidence copy bytes')
    return data


def family(name: str) -> str | None:
    for prefix, key in (('@esbuild/', 'esbuild'), ('@rollup/rollup-', 'rollup'), ('@napi-rs/lzma-', 'lzma')):
        if name.startswith(prefix):
            return key
    return name if name in ('dlv', 'saxes', 'stackback') else None


def check_source_comparison(key: str, source: dict) -> None:
    comparison = source['source_comparison']
    require(comparison.get('upstream_archive_url') ==
            f'https://codeload.github.com/{source["repository"]}/tar.gz/{source["commit"]}'
            and digest(comparison.get('upstream_archive_sha256')), 'Invalid immutable source archive')
    rows = comparison['javascript']
    coverage = {
        'dlv': {'index.js': True, 'dist/dlv.es.js': False, 'dist/dlv.js': False, 'dist/dlv.umd.js': False},
        'saxes': {'saxes.js': False},
        'stackback': {'index.js': True, 'formatstack.js': True, 'test.js': True},
    }[key]
    require(len(rows) == len(coverage) and {r['npm_path'] for r in rows} == set(coverage),
            'Changed JavaScript source coverage')
    for row in rows:
        require(digest(row.get('sha256')) and row.get('upstream_path') ==
                (row['npm_path'] if coverage[row['npm_path']] else None), 'Changed source match evidence')
    maps, embedded = comparison['source_maps'], comparison['embedded_sources']
    if key == 'dlv':
        expected = {path + '.map' for path, matched in coverage.items() if not matched}
        require(len(maps) == len(embedded) == 3 and {r['map'] for r in maps} == expected
                and {r['map'] for r in embedded} == expected, 'Incomplete embedded source coverage')
        source_hash = next(r['sha256'] for r in rows if r['npm_path'] == 'index.js')
        require(all(r['sources'] == ['../index.js'] and r['embedded_contents'] == 1 for r in maps)
                and all(r['source'] == '../index.js' and r['sha256'] == source_hash
                        and r['identical_upstream_paths'] == ['index.js'] for r in embedded),
                'Changed embedded source match evidence')
    else:
        require(embedded == [] and maps == ([] if key == 'stackback' else [
            {'map': 'saxes.js.map', 'sources': ['../../src/saxes.ts'], 'embedded_contents': 0}]),
            'Cannot invent embedded source correspondence')


def check_supplement(root: Path = ROOT) -> dict:
    manifest = read_json(root / MANIFEST)
    require(type(manifest.get('schema_version')) is int and manifest['schema_version'] == 1 and
            manifest.get('scope') == 'fifty-five-npm-distributions-missing-license-files', 'Unknown evidence scope')
    require(manifest.get('complete_sbom') is False and manifest.get('release_approved') is False,
            'Partial evidence must not claim complete SBOM or release approval')
    require(set(manifest['lock_sha256_lf']) == set(PROJECTS), 'Incomplete lock coverage')
    locked, selected = {}, {}
    for project in PROJECTS:
        path = root / project / 'package-lock.json'
        lock = read_json(path)
        require(lock.get('lockfileVersion') == 3, 'Unsupported lock format')
        actual = hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        require(actual == manifest['lock_sha256_lf'][project], 'Lock drift requires renewed license review')
        locked[project] = lock['packages']
        for package_path, row in lock['packages'].items():
            if package_path:
                name = package_path.rsplit('node_modules/', 1)[-1]
                if family(name):
                    require(not row.get('link') and row.get('name', name) == name, 'Unsupported package alias or link')
                    selected[project, package_path] = (name, row)
    sources = manifest['sources']
    require(set(sources) == set(SOURCES), 'Missing or unreviewed source family')
    copies = 0
    for key, (repository, _, expected_copies) in SOURCES.items():
        source = sources[key]
        require(source.get('repository') == repository and digest(source.get('commit'), 40), 'Invalid upstream source')
        require(source.get('basis') == ('matching-tag-and-source' if key == 'stackback' else 'registry-gitHead'),
                'Wrong source evidence basis')
        require(source.get('binary_reproduced') is False and source.get('release_approved') is False
                and isinstance(source.get('remaining_review'), list)
                and len(source['remaining_review']) >= 2
                and all(isinstance(s, str) and s.strip() for s in source['remaining_review']),
                'Missing evidence limitations')
        require(len(source['copies']) == len(expected_copies), 'Incomplete license or attribution copies')
        for record, (upstream, expected) in zip(source['copies'], expected_copies):
            data = copy_bytes(root, record, expected)
            require(record.get('upstream_path') == upstream and record.get('url') ==
                    f'https://raw.githubusercontent.com/{repository}/{source["commit"]}/{upstream}',
                    'License must refer to the same fixed source commit')
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            require(record.get('git_blob_sha1') == blob and record.get('bytes') == len(data), 'Invalid license source fingerprint')
            copies += 1
        if key in ('dlv', 'saxes', 'stackback'):
            check_source_comparison(key, source)
        if key in ('esbuild', 'rollup'):
            parent = source['parent_license_match']
            row = locked['deploy/new_html']['node_modules/' + key]
            require(parent.get('name') == key and parent.get('version') == row['version']
                    and parent.get('url') == row['resolved'] and parent.get('integrity') == row['integrity']
                    and digest(parent.get('archive_sha256')) and digest(parent.get('sha256'))
                    and parent.get('archive_path') == 'package/LICENSE.md' and parent.get('upstream_path') == 'LICENSE.md',
                    'Changed parent license evidence')
            if key == 'esbuild':
                require(parent['sha256'] == source['copies'][0]['sha256'], 'Parent license does not match source')
    declaration = sources['dlv']['declaration']
    data = copy_bytes(root, declaration, 'declarations/npm-dlv-1.1.3.txt')
    require(declaration.get('kind') == 'archive-readme-section-not-license-body'
            and declaration.get('source_path') == 'package/README.md' and digest(declaration.get('source_sha256'))
            and data == b'### License\n\n[MIT](https://oss.ninja/mit/developit/)\n', 'Changed exact-version declaration')
    records, seen, names = manifest['packages'], set(), set()
    require(len(records) == 55 and Counter(r['source'] for r in records) ==
            Counter({key: value[1] for key, value in SOURCES.items()}), 'Incomplete scoped package coverage')
    for record in records:
        name, version, key = record['name'], record['version'], record['source']
        require(family(name) == key and (name, version) not in names, 'Duplicate or unreviewed package')
        names.add((name, version))
        archive, registry = record['archive'], record['registry']
        require(digest(archive.get('sha256')) and archive.get('standalone_license_files') == [], 'Changed archive evidence')
        sri_hash(archive['integrity'])
        require(registry.get('url') == f'https://registry.npmjs.org/{quote(name, safe="")}/{version}'
                and digest(registry.get('sha256')) and registry.get('declared_license') == ('ISC' if key == 'saxes' else 'MIT')
                and registry.get('git_head') == (None if key == 'stackback' else sources[key]['commit'])
                and 'author' in registry, 'Invalid exact-version registry evidence')
        require(bool(record['consumers']), 'Missing locked consumer')
        for consumer in record['consumers']:
            identity = consumer['project'], consumer['path']
            require(identity in selected and identity not in seen, 'Missing or duplicate locked consumer')
            seen.add(identity)
            locked_name, row = selected[identity]
            require(locked_name == name and row['version'] == version and row['resolved'] == archive['url']
                    and row['integrity'] == archive['integrity'] and row.get('license') == consumer.get('declared_license'),
                    'Archive differs from locked package')
    require(seen == set(selected), 'Incomplete scoped lock coverage')
    return {'packages': len(records), 'source_families': len(sources), 'license_and_attribution_copies': copies,
            'readme_declarations': 1, 'complete_sbom': False, 'release_approved': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        result = check_supplement(args.root.resolve())
    except (EvidenceError, InventoryError, OSError, ValueError, KeyError, TypeError, AttributeError):
        print('npm license evidence check failed; review locks, copies, origins, and incomplete-review markers')
        return 1
    import json
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
