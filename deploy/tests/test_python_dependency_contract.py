"""Guard runtime/test dependency separation and repeatable direct versions."""
import configparser
from pathlib import Path

from packaging.requirements import Requirement
from packaging.version import Version


ROOT = Path(__file__).resolve().parents[2]


def requirements(filename):
    return [Requirement(line) for raw in (ROOT / 'deploy' / filename).read_text().splitlines()
            if (line := raw.strip()) and not line.startswith('#')]


def test_runtime_and_test_requirements_use_exact_non_url_versions():
    for filename in ('requirements.txt', 'requirements-test.txt'):
        items = requirements(filename)
        assert len({item.name.lower() for item in items}) == len(items)
        for item in items:
            specs = list(item.specifier)
            assert len(specs) == 1 and specs[0].operator == '=='
            assert '*' not in specs[0].version and item.url is None


def test_test_tools_do_not_ship_as_runtime_dependencies():
    runtime = {item.name.lower() for item in requirements('requirements.txt')}
    tests = {item.name.lower() for item in requirements('requirements-test.txt')}
    assert not runtime.intersection({'pytest', 'pytest-asyncio', 'fakeredis', 'pip-audit'})
    assert {'pytest', 'pytest-asyncio', 'fakeredis'} <= tests
    assert 'httpx' in runtime  # Payment HTTP calls must not depend on test installs.


def test_security_fixed_pytest_and_compatible_asyncio_plugin():
    versions = {item.name.lower(): Version(next(iter(item.specifier)).version)
                for item in requirements('requirements-test.txt')}
    assert Version('9.0.3') <= versions['pytest'] < Version('10')
    assert Version('1.3') <= versions['pytest-asyncio'] < Version('2')


def test_async_tests_and_fixtures_keep_function_owned_loops():
    config = configparser.ConfigParser()
    config.read(ROOT / 'deploy/pytest.ini')
    assert config['pytest']['asyncio_mode'] == 'auto'
    assert config['pytest']['asyncio_default_fixture_loop_scope'] == 'function'
    assert config['pytest']['asyncio_default_test_loop_scope'] == 'function'


def test_manual_installation_checks_bootstrap_and_transitive_dependencies():
    manual = (ROOT / 'docs/open-source/manual-installation.zh-CN.md').read_text(encoding='utf-8')
    assert manual.count('python -m pip --isolated install --require-hashes -r deploy/dependency-locks/bootstrap.txt') == 2
    assert manual.count('python -m pip --isolated install --require-hashes -r deploy/dependency-locks/build.txt') == 2
    for profile in ('linux-cpython312', 'windows-cpython312'):
        assert f'--profile {profile} --check-environment' in manual
        assert f'--no-build-isolation -r deploy/dependency-locks/{profile}-runtime.txt' in manual
        assert f'{profile}-test.txt' in manual
    assert 'dependency-review.zh-CN.md' in manual
    review = (ROOT / 'docs/open-source/dependency-review.zh-CN.md').read_text(encoding='utf-8')
    assert 'requirements-test.txt' in review
    assert '--fix' in review
    assert 'SBOM' in review
