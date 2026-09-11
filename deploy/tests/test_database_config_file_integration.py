import importlib


DB_ENV_KEYS = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_POOL_MIN_SIZE",
    "DB_POOL_MAX_SIZE",
    "DB_MAX_QUERIES",
    "DB_MAX_IDLE_TIME",
    "DB_SSLMODE",
]


def clear_db_env(monkeypatch):
    for key in DB_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_db_manager_config_reads_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    import core.db_manager as db_manager

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_NAME=file_db\n"
        "DB_USER=file_user\n"
        "DB_PASSWORD=file_password\n"
        "DB_POOL_MIN_SIZE=3\n"
        "DB_POOL_MAX_SIZE=7\n"
        "DB_MAX_QUERIES=123\n"
        "DB_MAX_IDLE_TIME=45.5\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)
    cfg = importlib.reload(db_manager).DatabaseConfig()

    assert cfg.HOST == "file-host"
    assert cfg.PORT == 15432
    assert cfg.DATABASE == "file_db"
    assert cfg.USER == "file_user"
    assert cfg.PASSWORD == "file_password"
    assert cfg.MIN_SIZE == 3
    assert cfg.MAX_SIZE == 7
    assert cfg.MAX_QUERIES == 123
    assert cfg.MAX_INACTIVE_CONNECTION_LIFETIME == 45.5


def test_database_config_helper_uses_same_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    import core.database_config as database_config

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_NAME=file_db\n"
        "DB_USER=file_user\n"
        "DB_PASSWORD=file_password\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)
    config_module = importlib.reload(database_config)

    params = config_module.DatabaseConfig.get_connection_params()

    assert params["host"] == "file-host"
    assert params["port"] == 15432
    assert params["database"] == "file_db"
    assert params["user"] == "file_user"
    assert params["password"] == "file_password"
    assert params["ssl"] == "verify-full"
    assert config_module.DatabaseConfig.get_connection_string() == (
        "postgresql://file_user:file_password@file-host:15432/file_db?sslmode=verify-full"
    )


def test_fresh_db_builder_uses_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    from db_build import build_fresh_db

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=builder-host\n"
        "DB_PORT=25432\n"
        "DB_NAME=builder_db\n"
        "DB_USER=builder_user\n"
        "DB_PASSWORD=builder_password\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)

    assert build_fresh_db.db_connection_config() == {
        "host": "builder-host",
        "port": 25432,
        "database": "builder_db",
        "user": "builder_user",
        "password": "builder_password",
        "ssl": "verify-full",
    }
