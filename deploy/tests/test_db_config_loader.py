from pathlib import Path

import pytest


def test_database_env_file_value_is_used(tmp_path):
    from core.db_config_loader import get_db_config_value

    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_PASSWORD='test-placeholder-credential'\n",
        encoding="utf-8",
    )

    assert get_db_config_value("DB_HOST", "localhost", config_file=config_file, environ={}) == "file-host"
    assert get_db_config_value("DB_PORT", "5432", config_file=config_file, environ={}) == "15432"
    assert get_db_config_value("DB_PASSWORD", "changeme", config_file=config_file, environ={}) == "test-placeholder-credential"


def test_process_environment_overrides_database_env_file(tmp_path):
    from core.db_config_loader import get_db_config_value

    config_file = tmp_path / "database.env"
    config_file.write_text("DB_HOST=file-host\n", encoding="utf-8")

    value = get_db_config_value(
        "DB_HOST",
        "localhost",
        config_file=config_file,
        environ={"DB_HOST": "env-host"},
    )

    assert value == "env-host"


def test_default_is_used_when_env_and_file_are_missing(tmp_path):
    from core.db_config_loader import get_db_config_value

    missing_file = tmp_path / "missing.env"

    assert get_db_config_value("DB_HOST", "localhost", config_file=missing_file, environ={}) == "localhost"


def test_malformed_database_env_line_raises_useful_error(tmp_path):
    from core.db_config_loader import load_database_env_file

    config_file = tmp_path / "database.env"
    config_file.write_text("DB_HOST=file-host\nBROKEN_LINE\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"database\.env:2"):
        load_database_env_file(config_file)
