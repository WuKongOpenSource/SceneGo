"""Resolve local media only inside explicitly configured storage roots."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional


def _root_path(value: str | os.PathLike[str], *, deploy_root: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = deploy_root / path
    return path.resolve()


def configured_media_roots(
    *,
    deploy_root: Path,
    include_uploads: bool = True,
) -> tuple[Path, ...]:
    """Return deduplicated local roots supported by current and legacy config."""
    root = deploy_root.resolve()
    values: list[str | os.PathLike[str]] = [
        root / "persistent_storage",
        os.getenv("STORAGE_BASE_PATH", "persistent_storage"),
        os.getenv("LOCAL_STORAGE_PATH", "persistent_storage"),
    ]
    if include_uploads:
        values.append(root / "temp" / "uploads")

    resolved: list[Path] = []
    for value in values:
        candidate = _root_path(value, deploy_root=root)
        if candidate not in resolved:
            resolved.append(candidate)
    return tuple(resolved)


def resolve_allowed_media_file(
    value: str | os.PathLike[str],
    *,
    deploy_root: Path,
    allowed_roots: Optional[Iterable[Path]] = None,
) -> Optional[Path]:
    """Resolve an existing regular file, rejecting traversal and symlink escape."""
    root = deploy_root.resolve()
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not resolved.is_file():
        return None

    roots = tuple(
        Path(item).resolve()
        for item in (allowed_roots or configured_media_roots(deploy_root=root))
    )
    if not any(resolved.is_relative_to(allowed_root) for allowed_root in roots):
        return None
    return resolved


def resolve_storage_url_file(
    url_path: str,
    *,
    deploy_root: Path,
    storage_roots: Optional[Iterable[Path]] = None,
) -> Optional[Path]:
    """Map a /storage/... URL to the first safe configured local file."""
    if not url_path.startswith("/storage/"):
        return None
    relative = url_path[len("/storage/"):]
    roots = tuple(
        Path(item).resolve()
        for item in (
            storage_roots
            or configured_media_roots(deploy_root=deploy_root, include_uploads=False)
        )
    )
    for root in roots:
        resolved = resolve_allowed_media_file(
            root / relative,
            deploy_root=deploy_root,
            allowed_roots=roots,
        )
        if resolved is not None:
            return resolved
    return None
