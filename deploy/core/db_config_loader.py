"""Database config file loader.

Resolution order:
1. Process environment variables.
2. deploy/configs/database.env.
3. Caller-provided defaults.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Mapping, Optional, Union

PathInput = Union[str, os.PathLike, Path]

DEPLOY_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_CONFIG_FILE = DEPLOY_DIR / "configs" / "database.env"


def _strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_database_env_file(config_file: Optional[PathInput] = None) -> Dict[str, str]:
    path = Path(config_file) if config_file is not None else DEFAULT_DATABASE_CONFIG_FILE
    if not path.exists():
        return {}

    values: Dict[str, str] = {}
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_no}: expected KEY=value")

        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key or any(ch.isspace() for ch in key):
            raise ValueError(f"{path}:{line_no}: invalid key {key!r}")

        values[key] = _strip_matching_quotes(raw_value.strip())
    return values


def get_db_config_value(
    key: str,
    default: str = "",
    *,
    config_file: Optional[PathInput] = None,
    environ: Optional[Mapping[str, str]] = None,
) -> str:
    env = os.environ if environ is None else environ
    if key in env:
        return str(env[key])

    file_values = load_database_env_file(config_file)
    return file_values.get(key, default)
