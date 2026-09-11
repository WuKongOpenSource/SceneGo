#!/usr/bin/env python3
"""Compare a native npm CycloneDX inventory with a registry-only v3 lock.

This offline contract detects stale or incomplete inventories. It does not
install packages, resolve semver ranges, validate the entire CycloneDX schema,
verify remote archive bytes, or approve licenses. Native npm resolution and
separate schema/archive/license review remain required.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlsplit


PATH_PROPERTY = 'cdx:npm:package:path'
DEV_PROPERTY = 'cdx:npm:package:development'
PACKAGE_NAME = r'(?:@[a-z0-9._-]+/)?[a-z0-9._-]+'
PACKAGE_PATH = re.compile(rf'node_modules/{PACKAGE_NAME}(?:/node_modules/{PACKAGE_NAME})*')
FIELDS = ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta')


class InventoryError(ValueError):
    """The inventory cannot establish correspondence with the selected lock."""


def read_json(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size > 16_000_000:
        raise InventoryError('Missing or oversized JSON input')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise InventoryError('Duplicate JSON key')
            result[key] = value
        return result
    result = json.loads(path.read_bytes().decode('utf-8'), object_pairs_hook=unique)
    if not isinstance(result, dict):
        raise InventoryError('JSON input must be an object')
    return result


def properties(component: dict) -> dict:
    result = {}
    for item in component.get('properties', []):
        name, value = item['name'], item['value']
        if name in result or not isinstance(value, str):
            raise InventoryError('Duplicate or invalid component property')
        result[name] = value
    return result


def purl(name: str, version: str) -> str:
    return f'pkg:npm/{quote(name, safe="/")}@{quote(version, safe="")}'


def resolve_path(packages: dict, parent: str, name: str) -> str | None:
    # Follow the locked node_modules hierarchy, never the host filesystem.
    parts = parent.split('/') if parent else []
    for size in range(len(parts), -1, -1):
        ancestor = parts[:size]
        if ancestor and ancestor[-1] == 'node_modules':
            continue
        candidate = '/'.join([*ancestor, 'node_modules', name])
        if candidate in packages:
            return candidate
    return None


def locked_edges(packages: dict, parent: str) -> set[str]:
    row = packages[parent]
    dependencies = dict(row.get('dependencies', {}))
    if not parent:
        dependencies.update(row.get('devDependencies', {}))
    optional = row.get('optionalDependencies', {})
    dependencies.update(optional)
    peers = row.get('peerDependencies', {})
    metadata = row.get('peerDependenciesMeta', {})
    edges = set()
    for name in dependencies.keys() | peers.keys():
        if not re.fullmatch(PACKAGE_NAME, name):
            raise InventoryError('Unsupported dependency name')
        target = resolve_path(packages, parent, name)
        if target is None:
            if name in optional or (name not in dependencies and metadata.get(name, {}).get('optional') is True):
                continue
            raise InventoryError(f'Missing locked dependency for {parent or "root"}')
        edges.add(target)
    return edges


def sri_hash(integrity: str) -> str:
    # The reviewed locks use one SHA-512 SRI token. Other forms need review,
    # rather than silently comparing a weaker or differently scoped digest.
    if not isinstance(integrity, str) or not integrity.startswith('sha512-'):
        raise InventoryError('Unsupported lock integrity; SHA-512 required')
    try:
        raw = base64.b64decode(integrity[7:], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise InventoryError('Invalid lock integrity') from exc
    if len(raw) != 64 or base64.b64encode(raw).decode() != integrity[7:]:
        raise InventoryError('Invalid lock integrity')
    return raw.hex()


def check_inventory(package: dict, lock: dict, bom: dict) -> dict:
    if lock.get('lockfileVersion') != 3 or bom.get('bomFormat') != 'CycloneDX' or bom.get('specVersion') != '1.5':
        raise InventoryError('Expected npm lock v3 and CycloneDX 1.5')
    packages = lock['packages']
    root = packages['']
    for field in ('name', 'version', *FIELDS):
        default = {} if field in FIELDS else None
        if package.get(field, default) != root.get(field, default):
            raise InventoryError(f'Package/lock input drift: {field}')
    if any(row.get('link') for row in packages.values()):
        raise InventoryError('Workspace/link dependencies need a separately reviewed profile')
    components = [bom['metadata']['component'], *bom['components']]
    by_path, by_ref = {}, {}
    for component in components:
        if component.get('components'):
            raise InventoryError('Nested BOM components need a separately reviewed profile')
        props = properties(component)
        path, ref = props.get(PATH_PROPERTY), component.get('bom-ref')
        if path not in packages or path in by_path or not isinstance(ref, str) or not ref or ref in by_ref:
            raise InventoryError('Missing, duplicate, or unknown component path/reference')
        row = packages[path]
        if component.get('version') != row['version']:
            raise InventoryError(f'Component version differs from lock: {path or "root"}')
        name = row.get('name') or path.rsplit('node_modules/', 1)[-1]
        if path:
            if not PACKAGE_PATH.fullmatch(path) or name != path.rsplit('node_modules/', 1)[-1]:
                raise InventoryError('Unsupported package path or alias')
            if component.get('name') != name or component.get('type') != 'library':
                raise InventoryError(f'Component identity differs from lock: {path}')
            url = row['resolved']
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or parsed.netloc != 'registry.npmjs.org' or parsed.query or parsed.fragment:
                raise InventoryError('Unreviewed package distribution origin')
            urls = [r['url'] for r in component.get('externalReferences', []) if r.get('type') == 'distribution']
            if urls != [url]:
                raise InventoryError(f'Component distribution differs from lock: {path}')
            expected_hash = {'alg': 'SHA-512', 'content': sri_hash(row['integrity'])}
            if component.get('hashes') != [expected_hash]:
                raise InventoryError(f'Component integrity differs from lock: {path}')
            if props.get(DEV_PROPERTY) != ('true' if row.get('dev') else None):
                raise InventoryError(f'Component development scope differs from lock: {path}')
            if component.get('scope') != ('optional' if row.get('dev') or row.get('optional') else 'required'):
                raise InventoryError(f'Component scope differs from lock: {path}')
        elif component.get('type') != 'application' or props.get(PATH_PROPERTY) != '':
            raise InventoryError('Missing application root')
        # npm lock-only mode may use the directory basename as root display
        # name. The purl, version, and locked root dependencies retain identity.
        if component.get('purl') != purl(name, row['version']):
            raise InventoryError(f'Component purl differs from lock: {path or "root"}')
        by_path[path], by_ref[ref] = component, path
    if set(by_path) != set(packages):
        raise InventoryError('Incomplete lock coverage, including optional or development packages')
    graph = {}
    for item in bom['dependencies']:
        ref, children = item['ref'], item['dependsOn']
        if ref not in by_ref or ref in graph or len(children) != len(set(children)) or any(c not in by_ref for c in children):
            raise InventoryError('Duplicate or dangling dependency graph reference')
        graph[ref] = set(children)
    if set(graph) != set(by_ref):
        raise InventoryError('Incomplete dependency graph node coverage')
    for ref, path in by_ref.items():
        expected = {by_path[target]['bom-ref'] for target in locked_edges(packages, path)}
        if graph[ref] != expected:
            raise InventoryError(f'Dependency edges differ from lock: {path or "root"}')
    return {
        'components': len(packages) - 1,
        'dependency_edges': sum(map(len, graph.values())),
        'platform_conditioned_packages': sum(bool(row.get('os') or row.get('cpu') or row.get('libc')) for path, row in packages.items() if path),
        'lock_coverage_verified': True,
        'schema_validated': False,
        'archive_bytes_verified': False,
        'release_approved': False,
    }


def normalize_native(package: dict, lock: dict, native: dict) -> dict:
    """Disambiguate npm's version-only references without inventing edges.

    Some native npm reports reuse bom-ref for separate paths of the same version.
    Only accept that encoding when every occurrence has the same referenced
    children and each agrees with the lock. Ambiguous graphs must be re-exported
    with a tool that retains dependency occurrences, not guessed here.
    """
    bom = deepcopy(native)
    components = [bom['metadata']['component'], *bom['components']]
    paths = [properties(component).get(PATH_PROPERTY) for component in components]
    packages = lock['packages']
    if len(paths) != len(set(paths)) or set(paths) != set(packages):
        raise InventoryError('Native component paths do not cover the lock exactly')
    old_refs = {path: component['bom-ref'] for path, component in zip(paths, components)}
    identities = {}
    for component in components:
        ref, identity = component['bom-ref'], component['purl']
        if ref in identities and identities[ref] != identity:
            raise InventoryError('Native reference collision between different package identities')
        identities[ref] = identity
    expected = {}
    for path, ref in old_refs.items():
        children = {old_refs[target] for target in locked_edges(packages, path)}
        if ref in expected and expected[ref] != children:
            raise InventoryError('Ambiguous native references require a path-aware re-export')
        expected[ref] = children
    graph = bom['dependencies']
    if Counter(row['ref'] for row in graph) != Counter(old_refs.values()):
        raise InventoryError('Native dependency graph occurrences differ from components')
    for row in graph:
        children = row['dependsOn']
        if len(children) != len(set(children)) or set(children) != expected[row['ref']]:
            raise InventoryError('Native dependency edges differ from lock; cannot normalize')
    new_refs = {}
    for path, component in zip(paths, components):
        ref = component['purl'] + '#' + quote(path or 'root', safe='')
        component['bom-ref'] = new_refs[path] = ref
    bom['dependencies'] = [{'ref': new_refs[path], 'dependsOn': sorted(new_refs[child] for child in locked_edges(packages, path))}
                           for path in paths]
    check_inventory(package, lock, bom)
    return bom


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--sbom', type=Path, required=True)
    parser.add_argument('--normalize-native', action='store_true',
                        help='Emit a checked path-unique BOM to stdout; never overwrite the raw input')
    args = parser.parse_args()
    paths = [args.project_root / 'package.json', args.project_root / 'package-lock.json', args.sbom]
    try:
        package, lock, bom = (read_json(path) for path in paths)
        if args.normalize_native:
            bom = normalize_native(package, lock, bom)
            bom['metadata'].setdefault('properties', []).append({
                'name': 'inventory:npm:raw-sbom-sha256',
                'value': hashlib.sha256(args.sbom.read_bytes()).hexdigest(),
            })
        result = check_inventory(package, lock, bom)
        result['input_sha256'] = {name: hashlib.sha256(path.read_bytes()).hexdigest()
                                  for name, path in zip(('package.json', 'package-lock.json', 'sbom'), paths)}
    except (InventoryError, OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError) as exc:
        # Input documents can contain private URLs; do not echo their contents.
        print(f'npm SBOM check failed ({type(exc).__name__}); review the selected inputs', file=sys.stderr)
        return 1
    print(json.dumps(bom if args.normalize_native else result, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
