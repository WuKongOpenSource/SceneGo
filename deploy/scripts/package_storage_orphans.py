from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import tarfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"orphan manifest not found: {path}")
    with path.open("r", newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def safe_source_path(storage_root: Path, row: Dict[str, str]) -> Optional[Path]:
    rel_path = (row.get("rel_path") or "").strip().replace("\\", "/")
    if rel_path:
        candidate = storage_root / rel_path
    else:
        raw_path = (row.get("path") or "").strip()
        if not raw_path:
            return None
        candidate = Path(raw_path)

    try:
        resolved = candidate.resolve()
        resolved.relative_to(storage_root.resolve())
        return resolved
    except Exception:
        return None


def safe_target_path(target_root: Path, rel_path: str) -> Optional[Path]:
    rel = Path(rel_path.replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts:
        return None
    try:
        resolved = (target_root / rel).resolve()
        resolved.relative_to(target_root.resolve())
        return resolved
    except Exception:
        return None


def materialize(
    rows: List[Dict[str, str]],
    *,
    storage_root: Path,
    package_root: Path,
    mode: str,
) -> Dict[str, Any]:
    target_root = package_root / "persistent_storage_orphans"
    stats = {
        "requested": len(rows),
        "created": 0,
        "skipped_existing": 0,
        "missing": 0,
        "unsafe": 0,
        "errors": 0,
        "bytes": 0,
    }
    materialized_rows: List[Dict[str, Any]] = []

    for row in rows:
        rel_path = (row.get("rel_path") or "").strip().replace("\\", "/")
        source = safe_source_path(storage_root, row)
        target = safe_target_path(target_root, rel_path) if rel_path else None
        out = dict(row)

        if not source or not target:
            stats["unsafe"] += 1
            out["package_status"] = "unsafe_path"
            materialized_rows.append(out)
            continue
        if not source.exists() or not source.is_file():
            stats["missing"] += 1
            out["package_status"] = "missing_source"
            materialized_rows.append(out)
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.stat().st_size == source.stat().st_size:
                    stats["skipped_existing"] += 1
                    out["package_status"] = "skipped_existing"
                    out["package_path"] = str(target)
                    materialized_rows.append(out)
                    continue
                raise RuntimeError(f"target exists with different size: {target}")

            if mode == "hardlink":
                os.link(source, target)
            elif mode == "copy":
                shutil.copy2(source, target)
            else:
                raise RuntimeError(f"unsupported mode: {mode}")

            size = source.stat().st_size
            stats["created"] += 1
            stats["bytes"] += size
            out["package_status"] = "created"
            out["package_path"] = str(target)
            out["packaged_size_bytes"] = size
        except Exception as exc:
            stats["errors"] += 1
            out["package_status"] = "error"
            out["package_error"] = str(exc)
        materialized_rows.append(out)

    write_csv(
        package_root / "manifests" / "packaged_disk_orphans.csv",
        materialized_rows,
        [
            "rel_path",
            "path",
            "size_bytes",
            "mtime",
            "legacy_refs",
            "package_status",
            "package_path",
            "packaged_size_bytes",
            "package_error",
        ],
    )
    return {"stats": stats, "rows": materialized_rows}


def write_readme(path: Path, summary: Dict[str, Any]) -> None:
    path.write_text(
        f"""# OSTORY Disk Orphan Export

Generated at: {summary["generated_at"]}

This package contains disk-only orphan files from `persistent_storage`.
They are intentionally excluded from the clean server migration package.

Use this package for manual review on the local workstation. Do not upload the
whole package back to a production server without re-selecting valid files.

## Counts

- Requested orphan files: {summary["stats"]["requested"]}
- Materialized files: {summary["stats"]["created"]}
- Skipped existing files: {summary["stats"]["skipped_existing"]}
- Missing source files: {summary["stats"]["missing"]}
- Unsafe paths blocked: {summary["stats"]["unsafe"]}
- Errors: {summary["stats"]["errors"]}
- Materialized bytes: {summary["stats"]["bytes"]}

## Layout

- `persistent_storage_orphans/`: copied or hardlinked orphan files, preserving original relative paths.
- `manifests/packaged_disk_orphans.csv`: per-file package status.
- `summary.json`: package summary.
""",
        encoding="utf-8",
    )


def make_archive(package_root: Path, archive_path: Path) -> None:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "w:gz") as tf:
        tf.add(package_root, arcname=package_root.name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package disk orphan files for local manual review")
    parser.add_argument("--storage-root", default=os.getenv("LOCAL_STORAGE_PATH", "persistent_storage"))
    parser.add_argument("--manifest", default="storage_audit_reports/disk_orphans.csv")
    parser.add_argument("--output-dir", default="orphan_storage_export")
    parser.add_argument("--mode", choices=["hardlink", "copy"], default="hardlink")
    parser.add_argument("--archive", action="store_true", help="Create a .tar.gz archive next to the output directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    storage_root = Path(args.storage_root).resolve()
    manifest = Path(args.manifest)
    output_dir = Path(args.output_dir)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    package_root = output_dir / f"disk_orphans_{timestamp}"
    package_root.mkdir(parents=True, exist_ok=True)

    rows = read_csv(manifest)
    result = materialize(
        rows,
        storage_root=storage_root,
        package_root=package_root,
        mode=args.mode,
    )
    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "storage_root": str(storage_root),
        "manifest": str(manifest),
        "package_root": str(package_root),
        "mode": args.mode,
        "stats": result["stats"],
    }
    (package_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_readme(package_root / "README.md", summary)

    if args.archive:
        archive_path = output_dir / f"{package_root.name}.tar.gz"
        summary["archive"] = str(archive_path)
        (package_root / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        make_archive(package_root, archive_path)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
