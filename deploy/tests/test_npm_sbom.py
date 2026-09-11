"""Reject incomplete lock inventories without installing or contacting npm."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts import check_npm_sbom as inventory


@pytest.fixture
def documents():
    package = {'name': 'sample-app', 'version': '1.0.0', 'dependencies': {'a': '1', 'b': '1'},
               'devDependencies': {'tool': '1'}}
    root = deepcopy(package)
    packages = {'': root}
    specs = [
        ('a', {'dependencies': {'shared': '1'}, 'optionalDependencies': {'@native/linux-x64': '1'}}),
        ('b', {'dependencies': {'shared': '1'}}),
        ('tool', {'dev': True, 'peerDependencies': {'a': '*', 'absent-peer': '*'},
                  'peerDependenciesMeta': {'absent-peer': {'optional': True}}}),
        ('a/node_modules/shared', {}), ('b/node_modules/shared', {}),
        ('@native/linux-x64', {'optional': True, 'os': ['linux'], 'cpu': ['x64']}),
    ]
    components = []
    for path, extra in specs:
        name = path.rsplit('node_modules/', 1)[-1]
        row = {'version': '1.0.0', 'resolved': f'https://registry.npmjs.org/{name}/-/source.tgz',
               'integrity': 'sha512-' + base64.b64encode(b'x' * 64).decode(), **extra}
        path = 'node_modules/' + path
        packages[path] = row
        component = {'bom-ref': name + '@1.0.0', 'type': 'library', 'name': name, 'version': '1.0.0',
                     'purl': inventory.purl(name, '1.0.0'),
                     'scope': 'optional' if row.get('dev') or row.get('optional') else 'required',
                     'properties': [{'name': inventory.PATH_PROPERTY, 'value': path}],
                     'hashes': [{'alg': 'SHA-512', 'content': (b'x' * 64).hex()}],
                     'externalReferences': [{'type': 'distribution', 'url': row['resolved']}]}
        if row.get('dev'):
            component['properties'].append({'name': inventory.DEV_PROPERTY, 'value': 'true'})
        components.append(component)
    bom_root = {'bom-ref': 'sample-app@1.0.0', 'type': 'application', 'name': 'directory-name',
                'version': '1.0.0', 'purl': inventory.purl('sample-app', '1.0.0'),
                'properties': [{'name': inventory.PATH_PROPERTY, 'value': ''}]}
    by_path = {inventory.properties(c)[inventory.PATH_PROPERTY]: c for c in [bom_root, *components]}
    bom = {'bomFormat': 'CycloneDX', 'specVersion': '1.5', 'version': 1,
           'metadata': {'component': bom_root}, 'components': components,
           'dependencies': [{'ref': c['bom-ref'], 'dependsOn': sorted({by_path[target]['bom-ref']
                             for target in inventory.locked_edges(packages, path)})} for path, c in by_path.items()]}
    return package, {'lockfileVersion': 3, 'packages': packages}, bom


def test_native_duplicate_references_are_rejected_then_disambiguated(documents):
    with pytest.raises(inventory.InventoryError, match='reference'):
        inventory.check_inventory(*documents)
    original = deepcopy(documents[2])
    bom = inventory.normalize_native(*documents)
    result = inventory.check_inventory(*documents[:2], bom)
    assert result == {'components': 6, 'dependency_edges': 7, 'platform_conditioned_packages': 1,
                      'lock_coverage_verified': True, 'schema_validated': False,
                      'archive_bytes_verified': False, 'release_approved': False}
    assert documents[2] == original
    shared = [c for c in bom['components'] if c['name'] == 'shared']
    assert shared[0]['bom-ref'] != shared[1]['bom-ref']
    assert shared[0]['purl'] == shared[1]['purl']


@pytest.mark.parametrize('mutation', ['optional', 'dev', 'nested', 'duplicate-path', 'extra-path', 'version',
                                     'hash', 'url', 'dev-flag', 'scope', 'purl', 'name', 'nested-bom',
                                     'duplicate-property', 'duplicate-ref', 'missing-graph', 'extra-graph',
                                     'duplicate-graph', 'missing-edge', 'extra-edge', 'dangling', 'duplicate-edge'])
def test_corrupt_or_omitted_inventory_is_not_accepted(documents, mutation):
    package, lock, native = documents
    bom = inventory.normalize_native(*documents)
    components = bom['components']
    first = components[0]
    graph = bom['dependencies']
    if mutation in ('optional', 'dev', 'nested'):
        components.pop({'optional': 5, 'dev': 2, 'nested': 3}[mutation])
    elif mutation == 'duplicate-path':
        components.append(deepcopy(first))
    elif mutation == 'extra-path':
        first['properties'][0]['value'] = 'node_modules/unknown'
    elif mutation == 'version':
        first['version'] = '2.0.0'
    elif mutation == 'hash':
        first['hashes'][0]['content'] = '0' * 128
    elif mutation == 'url':
        first['externalReferences'][0]['url'] += '?token=private-value'
    elif mutation == 'dev-flag':
        components[2]['properties'].pop()
    elif mutation == 'scope':
        components[2]['scope'] = 'required'
    elif mutation == 'purl':
        first['purl'] = 'pkg:npm/b@1.0.0'
    elif mutation == 'name':
        first['name'] = 'b'
    elif mutation == 'nested-bom':
        first['components'] = [deepcopy(components[-1])]
    elif mutation == 'duplicate-property':
        first['properties'].append(deepcopy(first['properties'][0]))
    elif mutation == 'duplicate-ref':
        first['bom-ref'] = components[1]['bom-ref']
    elif mutation == 'missing-graph':
        graph.pop()
    elif mutation == 'extra-graph':
        graph.append({'ref': 'unknown', 'dependsOn': []})
    elif mutation == 'duplicate-graph':
        graph.append(deepcopy(graph[0]))
    elif mutation == 'missing-edge':
        graph[0]['dependsOn'].pop()
    elif mutation == 'extra-edge':
        graph[0]['dependsOn'].append(components[-1]['bom-ref'])
    elif mutation == 'dangling':
        graph[0]['dependsOn'].append('unknown')
    else:
        graph[0]['dependsOn'].append(graph[0]['dependsOn'][0])
    with pytest.raises(inventory.InventoryError):
        inventory.check_inventory(package, lock, bom)


@pytest.mark.parametrize('mutation', ['stale-input', 'workspace', 'alias', 'unsafe-path', 'foreign-origin',
                                     'sri', 'hash-algorithm', 'lock-format', 'bom-format', 'missing-dependency'])
def test_unsupported_lock_profiles_fail_closed(documents, mutation):
    package, lock, native = documents
    bom = inventory.normalize_native(*documents)
    row = lock['packages']['node_modules/a']
    if mutation == 'stale-input':
        package['dependencies']['a'] = '2'
    elif mutation == 'workspace':
        row['link'] = True
    elif mutation == 'alias':
        row['name'] = 'another-name'
    elif mutation == 'unsafe-path':
        lock['packages']['node_modules/a/../escape'] = lock['packages'].pop('node_modules/a')
        bom['components'][0]['properties'][0]['value'] = 'node_modules/a/../escape'
    elif mutation == 'foreign-origin':
        row['resolved'] = 'https://unreviewed.invalid/source.tgz'
    elif mutation == 'sri':
        row['integrity'] += ' invalid'
    elif mutation == 'hash-algorithm':
        row['integrity'] = 'sha1-' + base64.b64encode(b'x' * 20).decode()
    elif mutation == 'lock-format':
        lock['lockfileVersion'] = 2
    elif mutation == 'bom-format':
        bom['specVersion'] = '1.4'
    else:
        row['dependencies']['absent-required'] = '1'
    with pytest.raises(inventory.InventoryError):
        inventory.check_inventory(package, lock, bom)


@pytest.mark.parametrize('mutation', ['missing-edge', 'extra-graph', 'duplicate-path', 'ambiguous-graph'])
def test_normalizer_cannot_repair_or_invent_native_dependency_evidence(documents, mutation):
    package, lock, bom = documents
    if mutation == 'missing-edge':
        bom['dependencies'][0]['dependsOn'].pop()
    elif mutation == 'extra-graph':
        bom['dependencies'].append(deepcopy(bom['dependencies'][0]))
    elif mutation == 'duplicate-path':
        bom['components'].append(deepcopy(bom['components'][0]))
    else:
        lock['packages']['node_modules/a/node_modules/shared']['dependencies'] = {'tool': '1'}
    with pytest.raises(inventory.InventoryError):
        inventory.normalize_native(package, lock, bom)


def test_optional_peer_is_optional_but_required_peer_is_not(documents):
    package, lock, bom = documents
    del lock['packages']['node_modules/tool']['peerDependenciesMeta']
    with pytest.raises(inventory.InventoryError, match='Missing locked dependency'):
        inventory.normalize_native(package, lock, bom)


def test_normalizer_rejects_reference_collision_between_different_packages(documents):
    bom = documents[2]
    bom['components'][-1]['bom-ref'] = bom['components'][-2]['bom-ref']
    with pytest.raises(inventory.InventoryError, match='different package identities'):
        inventory.normalize_native(*documents)


@pytest.mark.parametrize('text', ['{"key":1,"key":2}', '[]', 'null', '{'])
def test_invalid_json_is_not_silently_reinterpreted(tmp_path, text):
    path = tmp_path / 'input.json'
    path.write_text(text, encoding='utf-8')
    with pytest.raises(ValueError):
        inventory.read_json(path)


def test_cli_normalization_and_validation_leave_inputs_unchanged(documents, tmp_path):
    paths = [tmp_path / name for name in ('package.json', 'package-lock.json', 'raw.cdx.json')]
    for path, data in zip(paths, documents):
        path.write_text(json.dumps(data), encoding='utf-8')
    before = [path.read_bytes() for path in paths]
    command = [sys.executable, str(Path(inventory.__file__)), '--project-root', str(tmp_path), '--sbom', str(paths[-1])]
    raw = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert raw.returncode == 1
    normalized = subprocess.run([*command, '--normalize-native'], capture_output=True, text=True, timeout=20)
    assert normalized.returncode == 0, normalized.stderr
    assert 'inventory:npm:raw-sbom-sha256' in normalized.stdout
    output = tmp_path / 'normalized.cdx.json'
    output.write_text(normalized.stdout, encoding='utf-8')
    checked = subprocess.run([*command[:-1], str(output)], capture_output=True, text=True, timeout=20)
    assert checked.returncode == 0, checked.stderr
    assert json.loads(checked.stdout)['lock_coverage_verified'] is True
    assert before == [path.read_bytes() for path in paths]
