#!/usr/bin/env python3
"""Check a scoped license evidence set against reviewed locks, entirely offline.

This detects accidental evidence drift. It neither authenticates upstream records
nor grants redistribution approval, and it is not a complete dependency SBOM.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlsplit

try:
    from . import check_python_dependency_locks as locks
except ImportError:
    import check_python_dependency_locks as locks


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = 'docs/open-source/third-party/'
MANIFEST = DIRECTORY + 'python-license-supplement.json'
REVIEWED = {
    'alibabacloud-credentials': ('credentials-python', 28, False),
    'alibabacloud-credentials-api': ('alibabacloud-credentials-api', 2, True),
    'alibabacloud-gateway-spi': ('alibabacloud-gateway', 3, True),
    'alibabacloud-tea': ('tea-python', 8, False),
    'alibabacloud-tea-openapi': ('darabonba-openapi', 23, False),
    'alibabacloud-tea-util': ('tea-util', 3, True),
    'darabonba-core': ('tea-python', 24, False),
}


class EvidenceError(ValueError):
    """The scoped evidence is incomplete, changed, or no longer fits the lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvidenceError(message)


def valid_hash(value, length=64) -> bool:
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{' + str(length) + '}', value) is not None


def relative_path(value, prefix='') -> bool:
    return (isinstance(value, str) and bool(value) and '\\' not in value and ':' not in value
            and not value.startswith('/') and '..' not in PurePosixPath(value).parts
            and str(PurePosixPath(value)) == value and value.startswith(prefix))


def check_copy(root: Path, record: dict, prefix: str) -> bytes:
    name = record.get('path')
    require(relative_path(name, prefix), 'Invalid evidence copy path')
    path = root / DIRECTORY / name
    require(path.resolve().is_relative_to((root / DIRECTORY).resolve()), 'External evidence copy')
    require(path.is_file() and path.stat().st_size <= 100_000, 'Missing or oversized evidence copy')
    data = path.read_bytes()
    require(valid_hash(record.get('sha256')) and hashlib.sha256(data).hexdigest() == record['sha256'],
            f'Evidence copy hash mismatch: {name}')
    return data


def check_supplement(root: Path = ROOT) -> dict:
    locks.check_locks(root)
    manifest = json.loads(locks.read_source(root, MANIFEST))
    require(manifest.get('schema_version') == 1
            and manifest.get('scope') == 'seven-python-distributions-missing-license-files', 'Unknown evidence scope')
    require(manifest.get('complete_sbom') is False and manifest.get('release_approved') is False,
            'Partial evidence must not claim complete SBOM or release approval')
    records = manifest.get('packages')
    require(isinstance(records, list) and len(records) == len(REVIEWED), 'Missing or duplicate evidence package')
    require({r['name'] for r in records} == set(REVIEWED), 'Unreviewed evidence package')
    profiles = {}
    for profile in locks.PROFILES:
        lines = locks.active_lines(locks.read_source(root, f'deploy/dependency-locks/{profile}-runtime.txt'))
        profiles[profile] = locks.packages([line for line in lines if not line.startswith('--')], hashed=True)
    matched = 0
    for record in records:
        name = record['name']
        repo, count, root_license = REVIEWED[name]
        require(record.get('review_status') == 'evidence-collected-not-release-approval'
                and bool(record.get('remaining_review')), 'Missing review limitations')
        require(record.get('author') and record.get('author_email') and record.get('declared_license'),
                'Missing upstream attribution metadata')
        require(set(record['installed_artifacts']) == set(locks.PROFILES), 'Missing installed artifact profile')
        for profile, packages in profiles.items():
            package = packages.get(name)
            require(package is not None and package.version == record['version']
                    and package.digest == record['installed_artifacts'][profile], f'Locked artifact drift: {name}')
        sdist = record['sdist']
        url = urlsplit(sdist['url'])
        require(url.scheme == 'https' and url.netloc == 'files.pythonhosted.org' and not url.query and not url.fragment
                and url.path.startswith('/packages/') and url.path.endswith('.tar.gz')
                and valid_hash(sdist.get('sha256')), 'Invalid source archive evidence')
        require(sdist.get('standalone_license_files') == [], 'Source license-file scope changed')
        if name == 'alibabacloud-tea':
            require(sdist['sha256'] == profiles[locks.PROFILES[0]][name].digest, 'Tea source archive drift')
        upstream = record['upstream']
        require(upstream.get('repository') == f'https://github.com/aliyun/{repo}'
                and valid_hash(upstream.get('commit'), 40), 'Invalid immutable upstream source')
        modules = upstream['modules']
        require(len(modules) == count and upstream.get('total_modules') == count
                and len({m['sdist_path'] for m in modules}) == count, 'Incomplete or duplicate source module evidence')
        verified = 0
        for module in modules:
            require(relative_path(module.get('sdist_path')) and module['sdist_path'].endswith('.py')
                    and valid_hash(module.get('sha256')), 'Invalid module fingerprint')
            if module.get('upstream_path') is not None:
                require(relative_path(module['upstream_path']) and module['upstream_path'].endswith(module['sdist_path']),
                        'Invalid upstream module path')
                verified += 1
        require(verified == upstream.get('matched_modules') == (0 if name == 'alibabacloud-tea' else count),
                'Source match coverage changed; re-review the evidence')
        matched += verified
        license_record = record['license_text']
        data = check_copy(root, license_record, 'licenses/')
        if root_license:
            require(record.get('license_evidence_kind') == 'upstream-root-license', 'Wrong license evidence kind')
            require(license_record['url'] == f'https://raw.githubusercontent.com/aliyun/{repo}/{upstream["commit"]}/LICENSE',
                    'License must come from the same fixed commit')
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            require(blob == license_record.get('git_blob_sha1'), 'Upstream license blob mismatch')
        else:
            require(record.get('license_evidence_kind') == 'sdist-readme-reference'
                    and license_record['url'] == 'https://www.apache.org/licenses/LICENSE-2.0.txt',
                    'Missing exact-version declaration or canonical license source')
        declaration = record.get('sdist_license_declaration')
        require(root_license or declaration is not None, 'Missing exact-version README declaration')
        if declaration is not None:
            require(declaration.get('source_path') == 'README.md' and declaration.get('section') == 'License'
                    and valid_hash(declaration.get('source_sha256')), 'Invalid declaration source fingerprint')
            check_copy(root, declaration['copy'], 'declarations/')
    return {'packages': len(records), 'matched_modules': matched,
            'unmatched_historical_modules': 8, 'complete_sbom': False, 'release_approved': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        result = check_supplement(args.root.resolve())
    except (EvidenceError, locks.LockError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        print(f'License evidence check failed: {exc}')
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
