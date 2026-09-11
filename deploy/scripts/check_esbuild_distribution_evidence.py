#!/usr/bin/env python3
"""Check scoped esbuild artifact observations and attribution copies offline.

The archives were inspected separately without execution. These relationships
detect evidence drift; they do not reproduce binaries or approve a release.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

try:
    from .check_npm_license_supplement import (
        DIRECTORY, MANIFEST as PARENT_MANIFEST, ROOT, EvidenceError, InventoryError,
        check_supplement, copy_bytes, digest, read_json, require,
    )
except ImportError:
    from check_npm_license_supplement import (
        DIRECTORY, MANIFEST as PARENT_MANIFEST, ROOT, EvidenceError, InventoryError,
        check_supplement, copy_bytes, digest, read_json, require,
    )


MANIFEST = DIRECTORY + 'npm-esbuild-build-evidence.json'
WASM = frozenset({'@esbuild/android-arm', '@esbuild/android-x64', '@esbuild/openharmony-arm64'})
GO_VERSION = 'go1.23.12'
ORIGINS = {
    'go': ('golang/go', 'dd8b7ad9268c2fbde675132a41b4e4da02eef94d', 'git/ref/tags/' + GO_VERSION),
    'sys': ('golang/sys', 'c0bba94af5f85fbad9f6dc2e04ed5b8fac9696cf', 'commits/c0bba94af5f8'),
}
X_SYS = ('dep\tgolang.org/x/sys\tv0.0.0-20220715151400-c0bba94af5f8\t'
         'h1:0A+M6Uqn+Eje4kHMK80dtF3JCXC4ykBgQG4Fe06QRhQ=')
LIMITATIONS = [
    'Publisher build metadata is not a reproducible-build or signed-provenance proof.',
    'WASM compilation provenance is not established by matching JavaScript loaders.',
    'Runtime, vendored code, transitive attribution, and final release approval remain open.',
]
LOADER_PATHS = {
    'package/wasm_exec.js': ('go', 'misc/wasm/wasm_exec.js'),
    'package/wasm_exec_node.js': ('go', 'misc/wasm/wasm_exec_node.js'),
    'package/bin/esbuild': ('esbuild', 'npm/esbuild-wasm/bin/esbuild'),
}


def unique_rows(rows: list, key: str, expected: set, label: str) -> dict:
    require(isinstance(rows, list) and len(rows) == len(expected)
            and {row[key] for row in rows} == expected, 'Incomplete or duplicate ' + label)
    return {row[key]: row for row in rows}


def check_origins(root: Path, sources: dict) -> None:
    require(set(sources) == set(ORIGINS), 'Changed attribution source coverage')
    for key, (repo, commit, origin) in ORIGINS.items():
        source = sources[key]
        require(source['repository'] == repo and source['commit'] == commit
                and source['origin_url'] == f'https://api.github.com/repos/{repo}/{origin}'
                and digest(source['origin_sha256']), 'Changed fixed attribution origin')
        copies = unique_rows(source['files'], 'upstream_path', {'LICENSE', 'PATENTS'}, 'Go attribution copies')
        for filename, record in copies.items():
            data = copy_bytes(root, record, 'licenses/npm-esbuild-go-' + filename + '.txt')
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            require(record['url'] == f'https://raw.githubusercontent.com/{repo}/{commit}/{filename}'
                    and record['git_blob_sha1'] == blob and record['bytes'] == len(data),
                    'Invalid attribution source fingerprint')


def check_native(row: dict, commit: str) -> None:
    require(set(row) == {'name', 'version', 'archive_sha256', 'kind', 'files', 'build_info_status',
                         'build_info_offset', 'go_version', 'module_info'}, 'Changed native evidence fields')
    require(row['build_info_status'] == 'embedded-metadata-only' and row['go_version'] == GO_VERSION,
            'Changed native build evidence status or Go version')
    platform, arch = row['name'].removeprefix('@esbuild/').rsplit('-', 1)
    goos = {'win32': 'windows', 'sunos': 'illumos'}.get(platform, platform)
    goarch = {'x64': 'amd64', 'ia32': '386', 'mips64el': 'mips64le'}.get(arch, arch)
    if platform == 'linux' and arch == 'ppc64':
        goarch = 'ppc64le'
    path = 'package/esbuild.exe' if platform == 'win32' else 'package/bin/esbuild'
    files = unique_rows(row['files'], 'path', {path}, 'native executable coverage')
    offset = row['build_info_offset']
    require(type(offset) is int and offset >= 0 and offset % 16 == 0
            and offset + 32 < files[path]['bytes'], 'Invalid native build-info offset')
    info = row['module_info']
    require(isinstance(info, str) and len(info) < 16_384 and info.endswith('\n'), 'Invalid module metadata')
    lines = info.splitlines()
    require(lines[:2] == ['path\tgithub.com/evanw/esbuild/cmd/esbuild',
                          'mod\tgithub.com/evanw/esbuild\t(devel)\t'], 'Changed esbuild module identity')
    # x/sys is absent on several targets; never project one platform's closure onto all others.
    dependencies = [X_SYS] if platform in {'android', 'darwin', 'freebsd', 'linux'} else []
    require([line for line in lines[2:] if line.startswith('dep\t')] == dependencies,
            'Changed platform dependency observations')
    builds = [line.removeprefix('build\t') for line in lines[2:] if line.startswith('build\t')]
    require(len(builds) + len(dependencies) == len(lines) - 2 and all('=' in line for line in builds),
            'Unreviewed module metadata')
    settings = dict(line.split('=', 1) for line in builds)
    require(len(settings) == len(builds), 'Duplicate native build setting')
    expected = {'GOOS': goos, 'GOARCH': goarch, 'CGO_ENABLED': '0', 'vcs': 'git',
                'vcs.revision': commit, 'vcs.modified': 'false', '-buildmode': 'exe', '-compiler': 'gc'}
    require(all(settings.get(key) == value for key, value in expected.items()), 'Changed native build metadata')


def check_evidence(root: Path = ROOT) -> dict:
    # Validate both locks and the parent evidence first; a matching count alone is not coverage.
    check_supplement(root)
    parent = read_json(root / PARENT_MANIFEST)
    manifest = read_json(root / MANIFEST)
    require(type(manifest['schema_version']) is int and manifest['schema_version'] == 1
            and manifest['scope'] == 'esbuild-platform-distributions-0.25.12',
            'Unknown esbuild evidence scope')
    require(all(manifest.get(key) is False for key in ('complete_sbom', 'release_approved', 'binary_reproduced'))
            and manifest['remaining_review'] == LIMITATIONS, 'Missing incomplete-review limitations')
    require(manifest['evidence_method'] == 'locked-archive-hashes-and-static-byte-inspection-no-execution',
            'Changed evidence method')
    sources = manifest['sources']
    check_origins(root, sources)
    esbuild = parent['sources']['esbuild']
    loaders = unique_rows(manifest['loaders'], 'archive_path', set(LOADER_PATHS), 'WASM loader source coverage')
    for path, (key, upstream) in LOADER_PATHS.items():
        row = loaders[path]
        source = esbuild if key == 'esbuild' else sources[key]
        require(row['repository'] == source['repository'] and row['commit'] == source['commit']
                and row['upstream_path'] == upstream and row['url'] ==
                f'https://raw.githubusercontent.com/{source["repository"]}/{source["commit"]}/{upstream}'
                and digest(row['git_blob_sha1'], 40) and digest(row['sha256'])
                and type(row['bytes']) is int and 0 < row['bytes'] < 100_000
                and row['matched_distributions'] == len(WASM), 'Changed fixed loader source observation')
    parents = {r['name']: r for r in parent['packages'] if r['source'] == 'esbuild'}
    rows = unique_rows(manifest['distributions'], 'name', set(parents), 'esbuild distribution coverage')
    native = 0
    for name, row in rows.items():
        require(row['version'] == parents[name]['version'] == '0.25.12'
                and row['archive_sha256'] == parents[name]['archive']['sha256'], 'Changed locked archive association')
        require(all(set(file) == {'path', 'sha256', 'bytes'} and digest(file['sha256'])
                    and type(file['bytes']) is int and 0 < file['bytes'] < 60_000_000 for file in row['files']),
                'Invalid artifact fingerprint')
        if name in WASM:
            require(set(row) == {'name', 'version', 'archive_sha256', 'kind', 'files', 'build_info_status'}
                    and row['kind'] == 'javascript-wasm' and row['build_info_status'] == 'not-established',
                    'WASM compilation provenance must remain unestablished')
            files = unique_rows(row['files'], 'path', {'package/esbuild.wasm', *LOADER_PATHS}, 'WASM file coverage')
            for path, loader in loaders.items():
                require(all(files[path][key] == loader[key] for key in ('sha256', 'bytes')), 'Changed WASM loader match')
        else:
            require(row['kind'] == 'native', 'Native distribution misclassified')
            check_native(row, esbuild['commit'])
            native += 1
    require(native == 23 and len(rows) == 26, 'Changed reviewed distribution forms')
    return {'distributions': 26, 'native_metadata_observed': native, 'wasm_compilation_unestablished': len(WASM),
            'loader_file_matches': len(loaders) * len(WASM), 'attribution_copies': 2, 'attribution_origins': 2,
            'binary_reproduced': False, 'complete_sbom': False, 'release_approved': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        result = check_evidence(args.root.resolve())
    except (EvidenceError, InventoryError, OSError, ValueError, KeyError, TypeError, AttributeError):
        print('esbuild evidence check failed; review locks, artifacts, sources, copies, and limitations')
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
