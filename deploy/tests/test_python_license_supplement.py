"""Keep partial upstream evidence explicit, intact, and tied to native locks."""
import json
from pathlib import Path
import shutil

import pytest

from scripts import check_python_dependency_locks as locks
from scripts import check_python_license_supplement as evidence


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def candidate(tmp_path):
    for relative in (*locks.INPUTS, *(f'deploy/dependency-locks/{name}' for name in (*locks.LOCK_FILES, 'manifest.json'))):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
    shutil.copytree(ROOT / evidence.DIRECTORY, tmp_path / evidence.DIRECTORY)
    return tmp_path


def revise(candidate, update):
    path = candidate / evidence.MANIFEST
    data = json.loads(path.read_text(encoding='utf-8'))
    update(data)
    path.write_text(json.dumps(data), encoding='utf-8')


def test_reviewed_partial_evidence_passes():
    assert evidence.check_supplement(ROOT) == {
        'packages': 7, 'matched_modules': 83, 'unmatched_historical_modules': 8,
        'complete_sbom': False, 'release_approved': False,
    }


@pytest.mark.parametrize('key', ['complete_sbom', 'release_approved'])
def test_partial_scope_cannot_claim_complete_review(candidate, key):
    revise(candidate, lambda data: data.update({key: True}))
    with pytest.raises(evidence.EvidenceError, match='must not claim'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('change', ['missing', 'duplicate', 'unreviewed'])
def test_package_coverage_cannot_silently_change(candidate, change):
    def update(data):
        rows = data['packages']
        if change == 'missing':
            rows.pop()
        elif change == 'duplicate':
            rows[-1] = rows[0]
        else:
            rows[-1]['name'] = 'unreviewed-package'
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError, match='package'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('change', ['version', 'artifact', 'profile'])
def test_stale_evidence_cannot_follow_a_changed_lock(candidate, change):
    def update(data):
        row = data['packages'][0]
        if change == 'version':
            row['version'] = '1.0.0'
        elif change == 'artifact':
            row['installed_artifacts']['linux-cpython312'] = '0' * 64
        else:
            del row['installed_artifacts']['windows-cpython312']
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError, match='artifact'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('relative', ['licenses/Apache-2.0.txt', 'declarations/alibabacloud-credentials.txt'])
@pytest.mark.parametrize('change', ['missing', 'tampered', 'crlf'])
def test_exact_license_and_attribution_copies_are_required(candidate, relative, change):
    path = candidate / evidence.DIRECTORY / relative
    if change == 'missing':
        path.unlink()
    elif change == 'tampered':
        path.write_bytes(path.read_bytes() + b'changed\n')
    else:
        path.write_bytes(path.read_bytes().replace(b'\n', b'\r\n'))
    with pytest.raises(evidence.EvidenceError, match='copy'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('path', ['../README.md', '/tmp/license', 'C:/license', 'licenses/../../README.md',
                                  'licenses\\license.txt', 'licenses//license.txt', 'licenses/./license.txt'])
def test_evidence_paths_cannot_escape_or_alias_the_reviewed_directory(candidate, path):
    revise(candidate, lambda data: data['packages'][0]['license_text'].update(path=path))
    with pytest.raises(evidence.EvidenceError, match='path'):
        evidence.check_supplement(candidate)


def test_symlink_copy_cannot_escape_evidence_directory(candidate, tmp_path):
    original = candidate / evidence.DIRECTORY / 'licenses/Apache-2.0.txt'
    outside = tmp_path / 'outside-license.txt'
    shutil.copyfile(original, outside)
    original.unlink()
    try:
        original.symlink_to(outside)
    except OSError:
        pytest.skip('The test host cannot create file symlinks')
    with pytest.raises(evidence.EvidenceError, match='External'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('change', ['source-url', 'commit', 'coverage', 'fingerprint', 'declaration', 'attribution'])
def test_origin_fingerprints_and_limitations_are_not_optional(candidate, change):
    def update(data):
        row = data['packages'][0]
        if change == 'source-url':
            row['sdist']['url'] = 'https://example.invalid/source.tar.gz'
        elif change == 'commit':
            row['upstream']['commit'] = 'main'
        elif change == 'coverage':
            row['upstream']['modules'].pop()
        elif change == 'fingerprint':
            row['upstream']['modules'][0]['sha256'] = 'invalid'
        elif change == 'declaration':
            del row['sdist_license_declaration']
        else:
            row['author'] = ''
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_supplement(candidate)


def test_root_license_must_match_the_same_source_commit(candidate):
    revise(candidate, lambda data: data['packages'][1]['license_text'].update(
        url='https://raw.githubusercontent.com/aliyun/alibabacloud-credentials-api/main/LICENSE'))
    with pytest.raises(evidence.EvidenceError, match='same fixed commit'):
        evidence.check_supplement(candidate)


def test_tea_historical_source_match_cannot_be_invented(candidate):
    def update(data):
        row = next(row for row in data['packages'] if row['name'] == 'alibabacloud-tea')
        row['upstream']['matched_modules'] = 8
        for module in row['upstream']['modules']:
            module['upstream_path'] = module['sdist_path']
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError, match='coverage changed'):
        evidence.check_supplement(candidate)


def test_manifest_checkout_line_endings_do_not_change_license_bytes(candidate):
    path = candidate / evidence.MANIFEST
    path.write_bytes(path.read_bytes().replace(b'\n', b'\r\n'))
    assert evidence.check_supplement(candidate)['packages'] == 7
