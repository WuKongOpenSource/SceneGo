"""Partial npm evidence must stay complete within scope without becoming approval."""
import json
from pathlib import Path
import shutil

import pytest

from scripts import check_npm_license_supplement as evidence


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def candidate(tmp_path):
    for project in evidence.PROJECTS:
        dest = tmp_path / project
        dest.mkdir(parents=True)
        shutil.copyfile(ROOT / project / 'package-lock.json', dest / 'package-lock.json')
    shutil.copytree(ROOT / evidence.DIRECTORY, tmp_path / evidence.DIRECTORY)
    return tmp_path


def revise(candidate, update):
    path = candidate / evidence.MANIFEST
    data = json.loads(path.read_text(encoding='utf-8'))
    update(data)
    path.write_text(json.dumps(data), encoding='utf-8')


def test_reviewed_partial_evidence_passes():
    assert evidence.check_supplement(ROOT) == {
        'packages': 55, 'source_families': 6, 'license_and_attribution_copies': 4,
        'readme_declarations': 1, 'complete_sbom': False, 'release_approved': False,
    }


@pytest.mark.parametrize('value', [True, 1.0, '1', None, 2])
def test_schema_version_must_be_the_reviewed_integer(candidate, value):
    revise(candidate, lambda data: data.update(schema_version=value))
    with pytest.raises(evidence.EvidenceError, match='scope'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('field', ['complete_sbom', 'release_approved'])
def test_scoped_evidence_cannot_claim_complete_approval(candidate, field):
    revise(candidate, lambda data: data.update({field: True}))
    with pytest.raises(evidence.EvidenceError, match='must not claim'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('field', ['binary_reproduced', 'release_approved', 'remaining_review'])
def test_native_license_does_not_prove_reproduction_or_complete_review(candidate, field):
    revise(candidate, lambda data: data['sources']['esbuild'].update({field: [] if field == 'remaining_review' else True}))
    with pytest.raises(evidence.EvidenceError, match='limitations'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('project', evidence.PROJECTS)
def test_lock_drift_requires_fresh_evidence(candidate, project):
    path = candidate / project / 'package-lock.json'
    data = json.loads(path.read_text())
    data['packages']['node_modules/esbuild']['version'] = '0.28.1'
    path.write_text(json.dumps(data))
    with pytest.raises(evidence.EvidenceError, match='Lock drift'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('field', ['version', 'integrity', 'url', 'consumer', 'duplicate', 'missing'])
def test_every_scoped_archive_and_consumer_must_match(candidate, field):
    def update(data):
        row = data['packages'][0]
        if field == 'version':
            row['version'] = '0.0.0'
        elif field in ('integrity', 'url'):
            row['archive'][field] = 'invalid'
        elif field == 'consumer':
            row['consumers'].pop()
        elif field == 'duplicate':
            data['packages'][-1] = row
        else:
            data['packages'].pop()
    revise(candidate, update)
    with pytest.raises((evidence.EvidenceError, evidence.InventoryError)):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('filename', ['licenses/npm-esbuild-0.25.12.txt', 'licenses/npm-rollup-4.63.1-core.txt',
                                     'licenses/npm-saxes-6.0.0.txt', 'licenses/npm-saxes-6.0.0-authors.txt',
                                     'declarations/npm-dlv-1.1.3.txt'])
@pytest.mark.parametrize('change', ['missing', 'changed', 'crlf'])
def test_full_original_license_and_attribution_bytes_are_required(candidate, filename, change):
    path = candidate / evidence.DIRECTORY / filename
    if change == 'missing':
        path.unlink()
    elif change == 'changed':
        path.write_bytes(path.read_bytes() + b'changed\n')
    else:
        path.write_bytes(path.read_bytes().replace(b'\n', b'\r\n'))
    with pytest.raises(evidence.EvidenceError, match='copy'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('value', ['../../README.md', 'licenses/../README.md', 'C:/license', '/tmp/license',
                                  'licenses\\license.txt', 'licenses//license.txt'])
def test_manifest_cannot_redirect_license_read(candidate, value):
    revise(candidate, lambda data: data['sources']['esbuild']['copies'][0].update(path=value))
    with pytest.raises(evidence.EvidenceError, match='path'):
        evidence.check_supplement(candidate)


def test_symlink_cannot_read_outside_evidence_directory(candidate):
    path = candidate / evidence.DIRECTORY / 'licenses/npm-esbuild-0.25.12.txt'
    outside = candidate / 'outside.txt'
    shutil.copyfile(path, outside)
    path.unlink()
    try:
        path.symlink_to(outside)
    except OSError:
        pytest.skip('This host cannot create file symlinks')
    with pytest.raises(evidence.EvidenceError, match='External'):
        evidence.check_supplement(candidate)


@pytest.mark.parametrize('field', ['registry-commit', 'license-url', 'source-commit', 'source-repo', 'blob',
                                  'parent', 'declaration', 'source-coverage', 'saxes-embedded', 'dlv-embedded'])
def test_origins_and_source_comparison_limitations_cannot_be_silently_changed(candidate, field):
    def update(data):
        source = data['sources']['esbuild']
        if field == 'registry-commit':
            data['packages'][0]['registry']['git_head'] = '0' * 40
        elif field == 'license-url':
            source['copies'][0]['url'] = source['copies'][0]['url'].replace(source['commit'], 'main')
        elif field == 'source-commit':
            source['commit'] = 'main'
        elif field == 'source-repo':
            source['repository'] = 'other/esbuild'
        elif field == 'blob':
            source['copies'][0]['git_blob_sha1'] = '0' * 40
        elif field == 'parent':
            source['parent_license_match']['version'] = '0.0.0'
        elif field == 'declaration':
            data['sources']['dlv']['declaration']['kind'] = 'license-body'
        elif field == 'source-coverage':
            data['sources']['stackback']['source_comparison']['javascript'].pop()
        elif field == 'saxes-embedded':
            data['sources']['saxes']['source_comparison']['embedded_sources'] = [{'source': 'saxes.ts'}]
        else:
            data['sources']['dlv']['source_comparison']['embedded_sources'][0]['sha256'] = '0' * 64
    revise(candidate, update)
    with pytest.raises(evidence.EvidenceError):
        evidence.check_supplement(candidate)


def test_deleting_a_source_family_fails(candidate):
    revise(candidate, lambda data: data['sources'].pop('lzma'))
    with pytest.raises(evidence.EvidenceError, match='family'):
        evidence.check_supplement(candidate)


def test_checkout_line_endings_do_not_invalidate_non_license_metadata(candidate):
    for relative in [evidence.MANIFEST, *(project + '/package-lock.json' for project in evidence.PROJECTS)]:
        path = candidate / relative
        path.write_bytes(path.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
    assert evidence.check_supplement(candidate)['packages'] == 55
