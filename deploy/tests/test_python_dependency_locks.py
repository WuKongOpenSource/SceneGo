"""Guard source-only lock integrity independently of the installed application."""
import json
from pathlib import Path
import shutil

import pytest

from scripts import check_python_dependency_locks as locks


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def candidate(tmp_path):
    for relative in (*locks.INPUTS, *(f'deploy/dependency-locks/{name}' for name in (*locks.LOCK_FILES, 'manifest.json'))):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
    return tmp_path


def rewrite(candidate, name, transform, *, rehash=False):
    target = candidate / 'deploy/dependency-locks' / name
    target.write_text(transform(target.read_text()), encoding='utf-8')
    if rehash:
        path = candidate / 'deploy/dependency-locks/manifest.json'
        manifest = json.loads(path.read_text())
        manifest['lock_sha256'][name] = locks.digest(target.read_text())
        path.write_text(json.dumps(manifest), encoding='utf-8')


def test_reviewed_native_lock_inputs_pass():
    result = locks.check_locks(ROOT)
    assert set(result) == set(locks.PROFILES)
    assert all(row['test_packages'] > row['runtime_packages'] for row in result.values())


def test_crlf_checkout_preserves_normalized_hashes(candidate):
    for path in candidate.rglob('*'):
        if path.is_file():
            path.write_bytes(path.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
    assert locks.check_locks(candidate) == locks.check_locks(ROOT)


def test_changed_requirements_invalidate_the_lock(candidate):
    with (candidate / locks.INPUTS[0]).open('a') as stream:
        stream.write('\nnew-package==1.0\n')
    with pytest.raises(locks.LockError, match='Requirements changed'):
        locks.check_locks(candidate)


def test_tampered_lock_is_not_silently_accepted(candidate):
    rewrite(candidate, 'bootstrap.txt', lambda text: text + '# changed\n')
    with pytest.raises(locks.LockError, match='hash mismatch'):
        locks.check_locks(candidate)


@pytest.mark.parametrize('replacement', [
    '--no-require-hashes', '--no-deps', '--trusted-host pypi.org', '--index-url https://example.invalid/simple',
    '--no-binary=:all:', '-r ../../requirements.txt', 'unhashed-package==1.0', 'floating-package>=1.0',
])
def test_rehashed_manifest_does_not_allow_unsafe_requirements(candidate, replacement):
    rewrite(candidate, 'linux-cpython312-runtime.txt', lambda text: text + replacement + '\n', rehash=True)
    with pytest.raises(locks.LockError):
        locks.check_locks(candidate)


def test_root_extras_cannot_disappear(candidate):
    rewrite(candidate, 'linux-cpython312-runtime.txt', lambda text: text.replace('uvicorn[standard]', 'uvicorn'), rehash=True)
    with pytest.raises(locks.LockError, match='direct requirement and its extras'):
        locks.check_locks(candidate)


def test_unreviewed_source_archive_is_rejected(candidate):
    rewrite(candidate, 'linux-cpython312-runtime.txt', lambda text: text.replace(locks.SOURCE_SHA256, '0' * 64), rehash=True)
    with pytest.raises(locks.LockError, match='source-only exception'):
        locks.check_locks(candidate)


def test_missing_profile_is_rejected(candidate):
    path = candidate / 'deploy/dependency-locks/manifest.json'
    manifest = json.loads(path.read_text())
    del manifest['profiles']['windows-cpython312']
    path.write_text(json.dumps(manifest))
    with pytest.raises(locks.LockError, match='profile'):
        locks.check_locks(candidate)


def native_environment(monkeypatch, *, os_name='linux', machine='x86_64', python=(3, 12, 3), libc=('glibc', '2.39')):
    monkeypatch.setattr(locks.platform, 'python_implementation', lambda: 'CPython')
    monkeypatch.setattr(locks.platform, 'machine', lambda: machine)
    monkeypatch.setattr(locks.platform, 'libc_ver', lambda: libc)
    monkeypatch.setattr(locks.sys, 'platform', os_name)
    monkeypatch.setattr(locks.sys, 'version_info', python)
    monkeypatch.setattr(locks.sys, 'maxsize', 2**63 - 1)
    monkeypatch.setattr(locks.ssl, 'OPENSSL_VERSION_INFO', (3, 0, 0))


@pytest.mark.parametrize('profile,os_name', [('linux-cpython312', 'linux'), ('windows-cpython312', 'win32')])
def test_matching_native_profile_passes(monkeypatch, profile, os_name):
    native_environment(monkeypatch, os_name=os_name)
    locks.check_environment(profile)


@pytest.mark.parametrize('changes', [
    {'python': (3, 13, 1)}, {'os_name': 'win32'}, {'machine': 'aarch64'},
    {'libc': ('musl', '1.2.5')}, {'libc': ('glibc', '2.33')},
])
def test_incompatible_host_fails_before_install(monkeypatch, changes):
    native_environment(monkeypatch, **changes)
    with pytest.raises(locks.LockError):
        locks.check_environment('linux-cpython312')
