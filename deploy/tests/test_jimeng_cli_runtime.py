import json
import hashlib
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.jimeng_cli_runtime import CliConfig, CliOutcomeUnknown, CliUnavailable, JimengCli, parse_object


def test_parse_observed_json_with_version_notice():
    assert parse_object(b'version notice\n{"submit_id":"task1","gen_status":"querying"}')['submit_id'] == 'task1'


@pytest.mark.parametrize('raw', [b'error only', b'[]', b'{"nested":{"submit_id":"x"}}\ntrailing untrusted', b'{broken', b'{"submit_id":"one"}\n{"submit_id":"two"}'])
def test_invalid_cli_output_is_safe(raw):
    with pytest.raises(CliOutcomeUnknown) as exc:
        parse_object(raw)
    assert raw.decode() not in str(exc.value)


def test_disabled_connector_never_uses_implicit_account(monkeypatch):
    monkeypatch.delenv('JIMENG_CLI_ENABLED', raising=False)
    with pytest.raises(CliUnavailable):
        CliConfig.load()


@pytest.mark.asyncio
async def test_exact_paid_argv_is_not_a_shell_and_never_inherits_secrets(monkeypatch, tmp_path):
    import services.jimeng_cli_runtime as runtime
    config = SimpleNamespace(binary=Path('/opt/dreamina'), home=tmp_path, uid=1234, gid=1234,
                             session_id='7654321', permit_input=Mock())
    captured = {}
    def run(args, **kwargs):
        captured.update(args=args, **kwargs)
        return SimpleNamespace(returncode=0, stdout=b'{"submit_id":"task1"}')
    monkeypatch.setattr(runtime.os, 'geteuid', lambda: 0, raising=False)
    monkeypatch.setattr(runtime.subprocess, 'run', run)
    monkeypatch.setenv('API_KEY', 'must-not-leak')
    cli = JimengCli(config)
    await cli.submit({'prompt': '$(echo malicious); original', 'duration': 5, 'ratio': '16:9'},
                     [{'kind': 'image', 'path': str(tmp_path / 'original.png')}])
    args = captured['args']
    assert args[1] == 'multimodal2video'
    assert args[args.index('--model_version') + 1] == 'seedance2.0mini'
    assert args[args.index('--session') + 1] == '7654321'
    assert args[args.index('--poll') + 1] == '0'
    assert not captured.get('shell') and 'API_KEY' not in captured['env']
    assert captured['user'] == 1234 and captured['extra_groups'] == []


@pytest.mark.asyncio
async def test_query_uses_verified_submit_id_flag(monkeypatch, tmp_path):
    from unittest.mock import AsyncMock
    cli = JimengCli(SimpleNamespace())
    cli._run = AsyncMock(return_value={'submit_id': 'abc'})
    await cli.query('abc', tmp_path)
    cli._run.assert_awaited_once_with(['query_result', '--submit_id', 'abc', '--download_dir', str(tmp_path)], timeout=180)


@pytest.mark.asyncio
async def test_account_mismatch_blocks_identity(monkeypatch):
    from unittest.mock import AsyncMock
    cli = JimengCli(SimpleNamespace(account_id='123', session_id='456'))
    cli._run = AsyncMock(return_value={'user_id': 'wrong', 'total_credit': 99})
    with pytest.raises(CliUnavailable):
        await cli.account_status()


@pytest.mark.asyncio
async def test_lock_contention_never_invokes_subprocess(monkeypatch, tmp_path):
    import services.jimeng_cli_runtime as runtime
    from contextlib import contextmanager
    config = SimpleNamespace(binary=Path('/opt/dreamina'), home=tmp_path, uid=1234, gid=1234)
    cli = JimengCli(config)
    @contextmanager
    def busy():
        raise BlockingIOError('already locked')
        yield
    monkeypatch.setattr(cli, '_state_lock', busy)
    monkeypatch.setattr(runtime.os, 'geteuid', lambda: 0, raising=False)
    run = Mock()
    monkeypatch.setattr(runtime.subprocess, 'run', run)
    with pytest.raises(runtime.CliNotStarted):
        await cli._run(['user_credit'], timeout=30)
    run.assert_not_called()


@pytest.mark.skipif(os.name != 'posix' or getattr(os, 'geteuid', lambda: -1)() != 0,
                    reason='Dedicated identity ownership test requires an isolated POSIX root container')
@pytest.mark.parametrize('invalid', [None, 'default_session', 'home_public', 'home_permissions', 'binary_writable', 'binary_changed'])
def test_posix_runtime_identity_and_pinned_binary(monkeypatch, tmp_path, invalid):
    home = tmp_path / 'private'
    binary = tmp_path / 'cli'
    home.mkdir(mode=0o700)
    binary.write_bytes(b'verified offline test executable')
    binary.chmod(0o755)
    os.chown(home, 1234, 1234)
    marker = home / '.ovideo-jimeng-state.json'
    marker.write_text(json.dumps({'account_id': '12345', 'session_id': '7654321', 'state_id': 'dedicated_state_123'}))
    marker.chmod(0o600)
    for key, value in {'ENABLED': 'true', 'BIN': str(binary), 'HOME': str(home), 'UID': '1234', 'GID': '1234',
                        'SHA256': hashlib.sha256(binary.read_bytes()).hexdigest()}.items():
        monkeypatch.setenv('JIMENG_CLI_' + key, value)
    if invalid == 'default_session':
        marker.write_text(json.dumps({'account_id': '12345', 'session_id': '0', 'state_id': 'dedicated_state_123'}))
    elif invalid == 'home_public':
        monkeypatch.chdir(tmp_path)
        home.rename(tmp_path / 'static')
        monkeypatch.setenv('JIMENG_CLI_HOME', str(tmp_path / 'static'))
    elif invalid == 'home_permissions':
        home.chmod(0o755)
    elif invalid == 'binary_writable':
        binary.chmod(0o777)
    elif invalid == 'binary_changed':
        binary.write_bytes(b'unverified replacement')
    if invalid:
        with pytest.raises(CliUnavailable) as exc:
            CliConfig.load()
        assert str(tmp_path) not in str(exc.value)
    else:
        config = CliConfig.load()
        assert config.session_id == '7654321' and config.uid == 1234
