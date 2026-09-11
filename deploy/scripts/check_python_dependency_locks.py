#!/usr/bin/env python3
"""Check reviewed Python lock inputs without installing packages or using the network.

The manifest detects accidental drift, not malicious changes to the source tag.
Native pip hash-mode installation remains the dependency-closure acceptance gate.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import platform
import re
import ssl
import sys


ROOT = Path(__file__).resolve().parents[2]
INPUTS = ('deploy/requirements.txt', 'deploy/requirements-test.txt')
PROFILES = ('linux-cpython312', 'windows-cpython312')
LOCK_FILES = ('bootstrap.txt', 'build.txt', *(f'{p}-{kind}.txt' for p in PROFILES for kind in ('runtime', 'test')))
HEADER = ('--index-url https://pypi.org/simple', '--require-hashes', '--only-binary=:all:')
SOURCE_EXCEPTION = '--no-binary=alibabacloud-tea'
SOURCE_VERSION = '0.4.3'
SOURCE_SHA256 = 'ec8053d0aa8d43ebe1deb632d5c5404339b39ec9a18a0707d57765838418504a'
REQUIREMENT = re.compile(r'([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[([a-z0-9,-]+)\])?==([0-9][A-Za-z0-9.!+-]*)')
PIN = re.compile(REQUIREMENT.pattern + r' --hash=sha256:([a-f0-9]{64})')


class LockError(ValueError):
    """A lock is incomplete, inconsistent with its inputs, or used on the wrong host."""


@dataclass(frozen=True)
class Package:
    version: str
    extras: frozenset[str]
    digest: str = ''


def read_source(root: Path, relative: str) -> str:
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise LockError(f'Missing or external lock input: {relative}')
    if path.stat().st_size > 256_000:
        raise LockError(f'Oversized lock input: {relative}')
    # Git checkouts may use CRLF, but lone CR, BOM, and NUL are not accepted.
    text = path.read_bytes().decode('utf-8').replace('\r\n', '\n')
    if any(char in text for char in ('\r', '\x00', '\ufeff')):
        raise LockError(f'Invalid text encoding: {relative}')
    return text


def digest(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def active_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]


def packages(lines: list[str], *, hashed: bool) -> dict[str, Package]:
    result: dict[str, Package] = {}
    for line in lines:
        match = (PIN if hashed else REQUIREMENT).fullmatch(line)
        if not match:
            raise LockError('Requirements must be exact named pins with SHA-256 in lock files')
        name = re.sub(r'[-_.]+', '-', match[1]).lower()
        if name in result:
            raise LockError(f'Duplicate package: {name}')
        result[name] = Package(match[3], frozenset((match[2] or '').split(',')) - {''}, match[4] if hashed else '')
    return result


def check_locks(root: Path = ROOT) -> dict[str, dict[str, int]]:
    directory = 'deploy/dependency-locks/'
    manifest = json.loads(read_source(root, directory + 'manifest.json'))
    if manifest.get('schema_version') != 1 or set(manifest.get('input_sha256', {})) != set(INPUTS):
        raise LockError('Unsupported manifest schema or requirement inputs')
    if set(manifest.get('lock_sha256', {})) != set(LOCK_FILES) or set(manifest.get('profiles', {})) != set(PROFILES):
        raise LockError('Missing or unreviewed lock profile')
    inputs = {}
    for name in INPUTS:
        text = read_source(root, name)
        if digest(text) != manifest['input_sha256'][name]:
            raise LockError(f'Requirements changed; resolve and review locks again: {name}')
        inputs[name] = packages(active_lines(text), hashed=False)
    locks = {}
    for name in LOCK_FILES:
        text = read_source(root, directory + name)
        if digest(text) != manifest['lock_sha256'][name]:
            raise LockError(f'Lock hash mismatch: {name}')
        lines = active_lines(text)
        if name.endswith('-test.txt'):
            header = ('-r ' + name.replace('-test.txt', '-runtime.txt'),)
        else:
            header = HEADER + ((SOURCE_EXCEPTION,) if name.endswith('-runtime.txt') else ())
        if tuple(lines[:len(header)]) != header:
            raise LockError(f'Unsafe or missing installation options: {name}')
        locks[name] = packages(lines[len(header):], hashed=True)
    if set(locks['bootstrap.txt']) != {'pip'} or set(locks['build.txt']) != {'setuptools', 'wheel', 'packaging'}:
        raise LockError('Installer and source-build tools must remain separately locked')
    versions: dict[str, str] = {}
    for lock in locks.values():
        for name, package in lock.items():
            if versions.setdefault(name, package.version) != package.version:
                raise LockError(f'Cross-profile or build/runtime version drift: {name}')
    counts = {}
    for profile in PROFILES:
        runtime = locks[profile + '-runtime.txt']
        overlay = locks[profile + '-test.txt']
        if runtime.keys() & overlay.keys():
            raise LockError('The test overlay must reuse, not replace, runtime dependencies')
        if runtime.get('alibabacloud-tea') != Package(SOURCE_VERSION, frozenset(), SOURCE_SHA256):
            raise LockError('The source-only exception requires a separately reviewed version and hash')
        for roots, installed in ((inputs[INPUTS[0]], runtime), (inputs[INPUTS[1]], runtime | overlay)):
            for name, expected in roots.items():
                actual = installed.get(name)
                if actual is None or actual.version != expected.version or not expected.extras <= actual.extras:
                    raise LockError(f'Lock does not retain the direct requirement and its extras: {name}')
        counts[profile] = {'runtime_packages': len(runtime), 'test_packages': len(runtime) + len(overlay)}
        if counts[profile] != manifest['profiles'][profile]:
            raise LockError(f'Package count differs from native resolution: {profile}')
    return counts


def check_environment(profile: str) -> None:
    if profile not in PROFILES:
        raise LockError('Unreviewed lock profile')
    if platform.python_implementation() != 'CPython' or sys.version_info[:2] != (3, 12):
        raise LockError('These locks require CPython 3.12; resolve other interpreters independently')
    if sys.maxsize <= 2**32 or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise LockError('These locks require a native x64 interpreter')
    expected = 'win32' if profile.startswith('windows-') else 'linux'
    if sys.platform != expected:
        raise LockError('The selected lock does not match this operating system')
    if expected == 'linux':
        libc, version = platform.libc_ver()
        if libc != 'glibc' or not re.fullmatch(r'\d+\.\d+(?:\.\d+)*', version) or tuple(map(int, version.split('.')[:2])) < (2, 34):
            raise LockError('The selected Linux wheels require glibc 2.34 or newer; musl needs a separate lock')
    # The inspected SMS source package changes its urllib3 requirement on old SSL.
    if ssl.OPENSSL_VERSION_INFO[:3] < (1, 1, 1):
        raise LockError('The source-build profile requires OpenSSL 1.1.1 or newer')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=PROFILES)
    parser.add_argument('--check-environment', action='store_true')
    args = parser.parse_args()
    if args.check_environment and not args.profile:
        parser.error('--check-environment requires an explicit --profile')
    try:
        result = check_locks()
        if args.check_environment:
            check_environment(args.profile)
    except (LockError, OSError, UnicodeError, ValueError, TypeError, KeyError) as exc:
        print(f'Python dependency lock check failed: {exc}', file=sys.stderr)
        return 1
    print(json.dumps({'lock_inputs_verified': True, 'profiles': result, 'environment_checked': args.profile if args.check_environment else None}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
