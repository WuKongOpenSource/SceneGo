"""Static native/WASM observations must not silently become build or release proof."""
import json
from pathlib import Path
import shutil
import sys

import pytest

from scripts import check_esbuild_distribution_evidence as evidence


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def candidate(tmp_path):
    for project in ('deploy/new_html', 'studio'):
        dest = tmp_path / project
        dest.mkdir(parents=True)
        shutil.copyfile(ROOT / project / 'package-lock.json', dest / 'package-lock.json')
    shutil.copytree(ROOT / evidence.DIRECTORY, tmp_path / evidence.DIRECTORY)
    return tmp_path


def revise(root, update, relative=evidence.MANIFEST):
    path = root / relative
    data = json.loads(path.read_text(encoding='utf-8'))
    update(data)
    path.write_text(json.dumps(data), encoding='utf-8')


def distribution(data, name='@esbuild/linux-x64'):
    return next(row for row in data['distributions'] if row['name'] == name)


def test_reviewed_forms_and_limits_pass():
    assert evidence.check_evidence(ROOT) == {
        'distributions': 26, 'native_metadata_observed': 23, 'wasm_compilation_unestablished': 3,
        'loader_file_matches': 9, 'attribution_copies': 2, 'attribution_origins': 2,
        'binary_reproduced': False, 'complete_sbom': False, 'release_approved': False,
    }


@pytest.mark.parametrize('value', [True, 1.0, '1', None, 2])
def test_schema_version_is_not_coerced(candidate, value):
    revise(candidate, lambda data: data.update(schema_version=value))
    with pytest.raises(evidence.EvidenceError, match='scope'):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('field', ['schema_version', 'scope', 'complete_sbom', 'release_approved',
                                 'binary_reproduced', 'evidence_method', 'remaining_review'])
def test_scope_and_incomplete_review_cannot_be_promoted(candidate, field):
    revise(candidate, lambda data: data.update({field: True}))
    with pytest.raises(evidence.EvidenceError):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('change', ['missing', 'duplicate', 'archive', 'version', 'kind', 'lock', 'parent'])
def test_distribution_coverage_and_exact_locked_association(candidate, change):
    def update(data):
        row = distribution(data)
        if change == 'missing':
            data['distributions'].pop()
        elif change == 'duplicate':
            data['distributions'][-1] = row
        else:
            row[{'archive': 'archive_sha256', 'version': 'version', 'kind': 'kind'}[change]] = '0' * 64
    if change == 'lock':
        revise(candidate, lambda data: data['packages'].pop('node_modules/@esbuild/linux-x64'),
               'deploy/new_html/package-lock.json')
    elif change == 'parent':
        revise(candidate, lambda data: next(row for row in data['packages'] if row['name'] ==
                                           '@esbuild/linux-x64')['archive'].update(sha256='0' * 64),
               evidence.PARENT_MANIFEST)
    else:
        revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('change', ['go_version', 'build_info_status', 'offset', 'path', 'size', 'digest',
                                 'revision', 'module', 'arch', 'cgo', 'missing-dep', 'extra-dep', 'duplicate-setting'])
def test_native_observations_cannot_drift(candidate, change):
    def update(data):
        row = distribution(data)
        if change in ('go_version', 'build_info_status'):
            row[change] = 'changed'
        elif change == 'offset':
            row['build_info_offset'] = row['files'][0]['bytes']
        elif change in ('path', 'size', 'digest'):
            key, value = {'path': ('path', 'package/esbuild.wasm'), 'size': ('bytes', -1),
                          'digest': ('sha256', 'invalid')}[change]
            row['files'][0][key] = value
        else:
            before, after = {
                'revision': ('vcs.revision=', 'vcs.other='),
                'module': ('mod\tgithub.com/evanw/esbuild\t', 'mod\tunreviewed\t'),
                'arch': ('GOARCH=amd64', 'GOARCH=arm64'),
                'cgo': ('CGO_ENABLED=0', 'CGO_ENABLED=1'),
                'missing-dep': (evidence.X_SYS + '\n', ''),
                'extra-dep': (evidence.X_SYS, evidence.X_SYS + '\ndep\textra\tv1.0.0\t'),
                'duplicate-setting': ('build\tGOARCH=amd64', 'build\tGOARCH=amd64\nbuild\tGOARCH=amd64'),
            }[change]
            assert before in row['module_info']
            row['module_info'] = row['module_info'].replace(before, after)
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('name', ['@esbuild/aix-ppc64', '@esbuild/netbsd-x64', '@esbuild/openbsd-arm64',
                                '@esbuild/sunos-x64', '@esbuild/win32-x64'])
def test_dependency_is_not_invented_on_other_platforms(candidate, name):
    def update(data):
        row = distribution(data, name)
        row['module_info'] += evidence.X_SYS + '\n'
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError, match='dependency'):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('name', sorted(evidence.WASM))
@pytest.mark.parametrize('change', ['kind', 'status', 'version', 'missing-file', 'duplicate-file', 'loader-bytes'])
def test_wasm_loaders_do_not_prove_compilation(candidate, name, change):
    def update(data):
        row = distribution(data, name)
        if change in ('kind', 'status', 'version'):
            key, value = {'kind': ('kind', 'native'), 'status': ('build_info_status', 'embedded-metadata-only'),
                          'version': ('go_version', evidence.GO_VERSION)}[change]
            row[key] = value
        elif change == 'missing-file':
            row['files'].pop()
        elif change == 'duplicate-file':
            row['files'][-1] = row['files'][0]
        else:
            next(file for file in row['files'] if file['path'] == 'package/wasm_exec.js')['sha256'] = '0' * 64
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('change', ['source', 'origin', 'copies', 'copy-path', 'source-url', 'blob',
                                 'loader-source', 'loader-url', 'loader-missing', 'loader-count'])
def test_attribution_and_loader_sources_stay_fixed(candidate, change):
    def update(data):
        source = data['sources']['go']
        if change == 'source':
            source['commit'] = 'main'
        elif change == 'origin':
            source['origin_url'] += '/other'
        elif change == 'copies':
            source['files'].pop()
        elif change in ('copy-path', 'source-url', 'blob'):
            key, value = {'copy-path': ('path', '../LICENSE'), 'source-url': ('url', 'https://example.org/LICENSE'),
                          'blob': ('git_blob_sha1', '0' * 40)}[change]
            source['files'][0][key] = value
        elif change == 'loader-missing':
            data['loaders'].pop()
        else:
            key, value = {'loader-source': ('commit', 'main'), 'loader-url': ('url', 'https://example.org/loader'),
                          'loader-count': ('matched_distributions', 26)}[change]
            data['loaders'][0][key] = value
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_evidence(candidate)


@pytest.mark.parametrize('filename', ['LICENSE', 'PATENTS'])
@pytest.mark.parametrize('change', ['missing', 'changed', 'crlf'])
def test_go_attribution_is_preserved_byte_for_byte(candidate, filename, change):
    path = candidate / evidence.DIRECTORY / ('licenses/npm-esbuild-go-' + filename + '.txt')
    if change == 'missing':
        path.unlink()
    else:
        data = path.read_bytes()
        path.write_bytes(data.replace(b'\n', b'\r\n') if change == 'crlf' else data + b'changed\n')
    with pytest.raises(evidence.EvidenceError, match='copy'):
        evidence.check_evidence(candidate)


def test_cli_fails_closed_without_echoing_malformed_input(candidate, monkeypatch, capsys):
    (candidate / evidence.MANIFEST).write_text('{untrusted-evidence-value', encoding='utf-8')
    monkeypatch.setattr(sys, 'argv', ['check', '--root', str(candidate)])
    assert evidence.main() == 1
    output = capsys.readouterr().out
    assert 'check failed' in output and 'untrusted-evidence-value' not in output
