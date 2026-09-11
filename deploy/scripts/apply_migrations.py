#!/usr/bin/env python3
"""Apply SQL migrations with a checksum ledger and transaction lock."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable

import asyncpg

DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    # Support direct CLI execution without relying on the working directory.
    sys.path.insert(0, str(DEPLOY_DIR))

from core.infrastructure_security import validate_database_security


LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_ms INTEGER NOT NULL DEFAULT 0,
    git_sha TEXT
)
"""
LOCK_NAME = "ostory:schema_migrations"
TRANSACTION_CONTROL = re.compile(r"^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$", re.IGNORECASE | re.MULTILINE)

# Keep exact aliases for migrations whose non-executable text changed after
# deployment. Unlisted content changes must still fail closed.
LEGACY_CHECKSUM_ALIASES = {
    "sql/database_schema.sql": {"d544a23283cccd3cc03794ef38c13e3afa5de032401c772cdd1b2ada2a9d1360": "68b57989a6c6f8eec86ba07adb148185cbf68f753651bb8ea111d2efb8312de4"},
    "sql/db_migration_add_permissions.sql": {"1b889e41622dfc8c765047d91a3444d48ca4250c621ae46fa04f820f2bb96cb0": "3ae40cb70d7cefa17b1865de506285e93f7b7f9c558edc4c66c4bbeadfa6856e"},
    "sql/db_migration_admin.sql": {"714750c47d7d4c8cfd46492b4fe0a88b484722a61df3a821353cdb9f489f1bfd": "31b09a93a187e91e9c091b3587ddb8a4acb49c53216d2e5f24d40d5645d0918b"},
    "sql/db_migration_admin_extra.sql": {"965d5d37529fc7946f4cec41d942712202eac7027a5ed54b08a00c626a85a238": "b62f4bdc9fe6486cf5aeed2b6c817a42fb71ee43cbcc30a367d81a42c72fa11c"},
    "sql/db_migration_admin_users_groups.sql": {"82b88580b0b144c1b7eef38100aac8ad093f34ad54e7e8c3a0808b961bee2fd0": "67b15f6bcc924599bc2ad1329657114a48a6aed6eee7c9ee8c19a3d12caf3fbf"},
    "sql/db_migration_api_config_category.sql": {"130ef1c60f0cc7b5b9f6708f49fec1580da7169f17093fbce8844e54c0aa2aa9": "f9c9a1bc62b75f1ec6cef53e20b36703a000d060a9acc243d476b9a7ee894bfc"},
    "sql/db_migration_assets.sql": {"dc2155d6fbf356d83c48a24fcf67ab56626e1f33cb584a950de202d5a5b39f6d": "fece7165ddf0bf5a5a65e4605bdb84a8a50c642efeb025e612fe85b4424591c6"},
    "sql/db_migration_audio_tracks.sql": {"e179c6a4ef07a79674e4cb0ece73be1061b9ff3b74008b0c9624558682a4965e": "ee8c2a3850fdff00371565c3ae2a12fff3853f72b660747c5b085a1017d19a73"},
    "sql/db_migration_character_voices.sql": {"4d212560310ac0111f6ca354b7b0a7c6d0a7f56e1466e6c07f1e3173f5dcd50a": "f502d253d09633fada5744d6d8c15ba4b052538f239069c78f017c7a1eb1fab3"},
    "sql/db_migration_clean_storyboard_data_urls.sql": {"e5201fec525c7852eb563328ec03af060b98fb10dc2fa9bc6ee2633f4cc30459": "19fd427c306d6ffa02b2a8bf2bc6648ab60733b8a285315a3e155385b0515cf7"},
    "sql/db_migration_content_workflow_model.sql": {"4ed2a1bbca74fa2d2f88e30ee55caa02c0d59b78632cd2ee51d573bc6a8debe0": "68be5bd34000f038381b47d1838b1a87d592680ed0cbfd740069dca33587150f"},
    "sql/db_migration_creation_points.sql": {"743d7c2c94c58d86bc2745f76f801d7f6ee007dbbc16539e150959af0d666226": "dbe714ffe1a708f4e060e64e90fd2a0aff31501dc3783887d2c426dffde052b0"},
    "sql/db_migration_credits.sql": {"7953c3fdd50b0a55b51ac1a537b248fef6f233499b8c5b6babf48b4855a39a75": "5a4d38086d7735b70805cfe0833e3f40804cd864efda00f1e9e6f481cb1a1b01"},
    "sql/db_migration_design_image_credit_pricing_v2.sql": {"0e0656a9d5ca513639e7f7477e94a086430f69e123102320c857ac3fc84050e8": "f40a21f67281430bcb5e6a791306376aee03fc0bdb338dea0ad2f63d39bcc61d"},
    "sql/db_migration_episode_script_segments.sql": {"23fb809b415f1f4784f28cde7b307c611993ceb4c5d78544548fcef288b7dc1f": "7075233d2ed4fa7d76e7c7fbaa31a12bee4b8734f36575fbf7d4cf11d0a88401"},
    "sql/db_migration_episode_scripts.sql": {"ece92aea476ae5763b2a44026880a42c0967437915871304962a97abf713c871": "1840dcbf21744537f81fd6e02f79bc9282dfa62a4e3fa84c4ac2fc921afbcfaa"},
    "sql/db_migration_episodes.sql": {"97b59bea6c0fa5cbc22d4c6ce699e445f38746beb204ffd8a9915d7de962203e": "1852c16bece3b74833a16364b63538037090d9844cb317ebb942f269c5864f32"},
    "sql/db_migration_final_product_shares.sql": {"be4754552f7577c39f25a3b36bd31f38a9b50111d6bf765c1c8385a0356e4f5a": "92fa8214a5f78902e3ecad60845f7c692101187e35deb0c5fa10573324815344"},
    "sql/db_migration_gpt_image_providers.sql": {"6c1dfc559c68f0f711009dc4864d9691e427c3e4410e9bbe28a2be7fbbea8278": "ececbd40681e618786aefaf4a0c6558176efc6203cdfea6bdbca8db994df581f"},
    "sql/db_migration_media_library.sql": {"458e65d6d38df4ca5d49dcc70a507b908c3d5825e43d3fe85422465692e42d92": "44d506f7936796482c95a0fef434b0f18cfbe23af04c0333f92b7670d15b8595"},
    "sql/db_migration_media_library_folders.sql": {"a12d447eba3d163c4b5d7534ec9a6a2c859e441f2e4e2fa8c1fe0b78b596289e": "a101860976b76eaf057b52740b4287bcda405e2fc1b36898b270c2b193812848"},
    "sql/db_migration_multi_scripts.sql": {"af07e41179a5c353e3629a70f70e5591f2cfad72ff889295ae9c9a649858ef2f": "b0753dbfc873709cfad60de60b6be2849959c69df0879b342fc66ef18b80fd8e"},
    "sql/db_migration_notifications.sql": {"2e5c573526cfdf5bfd26a0ca295967c78118b2f960612b74f64142b682b3454e": "898a521f96c15b63f57c073b3c7eb49d1861778b4f9be1721e95fc6e43959834"},
    "sql/db_migration_organizations.sql": {"3b74cd4fe912d39b5a7c0e5c60c336a6293e8e1564dac0d0e632be58a6ee2442": "ef454df19ef8fdd45b76b0d917feddd6587807ae5049287ee3298cb0438b001d"},
    "sql/db_migration_project_hub.sql": {"2d7ad1018b83740f82b052fa6ab0a7b2e654fd694b4f440f557c2789db3660ef": "fd174bef78cb94f1afff39735ab3fbc870df40932e3eb22495bb1056c2be7b01"},
    "sql/db_migration_project_soft_delete.sql": {"65a893e7084834cbb62ee3a7d80641a4903765d9dc66f32505a82ca2a211ac97": "7dac041e67007088376ce080c531ac42f49060a8bedf7d4dfb17006994ff6a3d"},
    "sql/db_migration_script_id.sql": {"9941c62ecdd00bc2e0ebc2bc4853bdc60b7f58d284ad6970e04b59ba92d19ea8": "38fbf8c7374b555bbb2346b105002f39e330d81032baf4be8448e19a89473ce7"},
    "sql/db_migration_storyboard_items.sql": {"e8493cb48e301d47b15b3646dbdac5b03e5f69d06d1f4d67f94f29d0cb22c766": "2a989cec9958154f606440c300c662083ae5a6e20d8995a1f3b4dcff89bd28d7"},
    "sql/db_migration_storyboard_pipeline_fields.sql": {"ecb1b918e4998086128858b0e27bcb89c2f09db7cd11f224621780555100f51c": "b4d614a1b44c34a7756b16ffc418cf06287b34400d137ad2b7ea7952db7c7867"},
    "sql/db_migration_timeline_tracks.sql": {"79d79db636443273ca1a3a25db145734b48a8e5755daf2d16d15595889360874": "d09bfe15c2bbeed97d155761c76d3afa54f85f58ffad7c3801d6ce65fe3012ce"},
    "sql/db_migration_unified_files.sql": {"c92cc4eccb0e1eda8e0f0723b6f6eed54f91f30480bc6bd940a2d8f4b9445616": "4f8956a765247ade106055cd5694b19a7f11371d71434a47b1a826b44e1355d5"},
    "sql/db_migration_video_reverse.sql": {"63d9aead1c79690ab25fdc0f4cac15f956b816df6f5916979f3552b7dad4ae13": "d090159ae1eaea3c3e043ad92101485cacb901733aa089a30ef6d3e5a137095b"},
    "sql/db_migration_video_segments.sql": {"8ebec2cb3e8ca999e0658721af36ed02e967e33710d9185145bd95b3a6ab8667": "cfb38c013398494f6770caf25cb30b92a2f1e6463199230315ef759c881e15cd"},
    "sql/db_migration_visibility_columns.sql": {"bbe53da49d6488f245e113b5e2a523302fadc130426687f7ed6c4fb23944fc40": "ee59732e06e218a95dc90058dc8c8779c344123444596e0308715c2d807b382b"},
    "sql/db_migration_wechat_creation_point_recharge.sql": {"d3fe4d41e847e2616bfa8b28d15e0212f0c36230ab4e23e576feabb4aa5e9c37": "7ab654554878b1cbbfeea954d0073c658add7c4691032acb908dca42c06db250"},
    "sql/db_migration_episode_script_sources.sql": {
        "bbe14ea12b6cc44d39e312d7fb3250b6957c33eab64b3ffe400c40fdd989d1e1":
            "96bd7022d476a3c5a3ca1b7cd34cb042632678b4c7c1ecf7afad72e64dfa0c00",
    },
    "sql/db_migration_script_conversations.sql": {
        "67a78fefe7467ae02c227d1a04de20be78875ed5bd2ed917032eefea6bed72eb":
            "64e2638039fcbcae56fb1375b217af28a738b238fa8f4c87013926db46284f9d",
    },
}

# These migrations predate the checksum ledger on the production database.
# Existing installations adopt them once; fresh databases still execute them.
LEGACY_BASELINE_FILENAMES = frozenset({
    "database_schema.sql",
    "db_migration_add_permissions.sql",
    "db_migration_unified_files.sql",
    "db_migration_project_soft_delete.sql",
    "db_migration_episodes.sql",
    "db_migration_episode_scripts.sql",
    "db_migration_episode_script_segments.sql",
    "db_migration_multi_scripts.sql",
    "db_migration_storyboard_items.sql",
    "db_migration_assets.sql",
    "db_migration_script_id.sql",
    "db_migration_storyboard_audio_mix.sql",
    "db_migration_storyboard_pipeline_fields.sql",
    "db_migration_storyboard_reference_config.sql",
    "db_migration_clean_storyboard_data_urls.sql",
    "db_migration_files_project_episode_source.sql",
    "db_migration_character_voices.sql",
    "db_migration_video_segments.sql",
    "db_migration_video_voice_references.sql",
    "db_migration_timeline_tracks.sql",
    "db_migration_project_hub.sql",
    "db_migration_audio_tracks.sql",
    "db_migration_admin_users_groups.sql",
    "db_migration_credits.sql",
    "db_migration_credit_onboarding.sql",
    "db_migration_notifications.sql",
    "db_migration_organizations.sql",
    "db_migration_media_library.sql",
    "db_migration_media_library_folders.sql",
    "db_migration_admin.sql",
    "db_migration_api_config_category.sql",
    "db_migration_api_config_model_bindings.sql",
    "db_migration_gpt_image_providers.sql",
    "db_migration_provider_remote_objects.sql",
    "db_migration_admin_extra.sql",
    "db_migration_visibility_columns.sql",
    "db_migration_video_reverse.sql",
})


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def migration_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migration_checksum_variants(path: Path) -> set[str]:
    """Return content-equivalent hashes for LF and CRLF checkouts."""
    raw = path.read_bytes()
    lf = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return {
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(lf).hexdigest(),
        hashlib.sha256(crlf).hexdigest(),
    }


def migration_checksum_matches(path: Path, version: str, recorded: str) -> bool:
    variants = migration_checksum_variants(path)
    if recorded in variants:
        return True
    canonical = LEGACY_CHECKSUM_ALIASES.get(version, {}).get(recorded)
    return bool(canonical and canonical in variants)


def migration_id(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def read_manifest(path: Path, *, root: Path) -> list[Path]:
    """Read an ordered migration manifest relative to the deployment root."""
    migrations: list[Path] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        migration = Path(line)
        migrations.append(migration if migration.is_absolute() else root / migration)
    return migrations


def prepare_migration_sql(sql: str) -> str:
    """Remove legacy outer transaction markers before the runner wraps the file."""
    return TRANSACTION_CONTROL.sub("", sql)


async def ensure_ledger(conn: Any) -> None:
    await conn.execute(LEDGER_DDL)


async def apply_one(
    conn: Any,
    path: Path,
    *,
    root: Path,
    git_sha: str = "",
    adopt_legacy_baseline: bool = False,
) -> str:
    if not path.is_file():
        raise FileNotFoundError(path)

    sql = prepare_migration_sql(path.read_text(encoding="utf-8"))
    checksum = migration_checksum(path)
    version = migration_id(path, root)
    existing = await conn.fetchrow(
        "SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = $1",
        version,
    )
    if existing:
        recorded = str(existing["checksum_sha256"])
        if not migration_checksum_matches(path, version, recorded):
            raise RuntimeError(
                f"Migration checksum mismatch for {version}: recorded={recorded}, current={checksum}"
            )
        return "skipped"

    if adopt_legacy_baseline and path.name in LEGACY_BASELINE_FILENAMES:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO schema_migrations (
                    migration_id, checksum_sha256, execution_ms, git_sha
                ) VALUES ($1, $2, 0, NULLIF($3, ''))
                """,
                version,
                checksum,
                git_sha or "legacy-baseline",
            )
        return "baselined"

    started = time.monotonic()
    async with conn.transaction():
        await conn.execute(sql)
        elapsed_ms = max(0, int((time.monotonic() - started) * 1000))
        await conn.execute(
            """
            INSERT INTO schema_migrations (
                migration_id, checksum_sha256, execution_ms, git_sha
            ) VALUES ($1, $2, $3, NULLIF($4, ''))
            """,
            version,
            checksum,
            elapsed_ms,
            git_sha,
        )
    return "applied"


async def apply_migrations(
    conn: Any,
    paths: Iterable[Path],
    *,
    root: Path,
    git_sha: str = "",
) -> list[tuple[str, str]]:
    existing_schema = bool(await conn.fetchval("SELECT to_regclass('public.users') IS NOT NULL"))
    await ensure_ledger(conn)
    await conn.execute("SELECT pg_advisory_lock(hashtext($1))", LOCK_NAME)
    results: list[tuple[str, str]] = []
    try:
        for path in paths:
            state = await apply_one(
                conn,
                path,
                root=root,
                git_sha=git_sha,
                adopt_legacy_baseline=existing_schema,
            )
            results.append((migration_id(path, root), state))
    finally:
        await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", LOCK_NAME)
    return results


async def list_migrations(conn: Any) -> list[Any]:
    await ensure_ledger(conn)
    return await conn.fetch(
        """
        SELECT migration_id, checksum_sha256, applied_at, execution_ms, git_sha
        FROM schema_migrations
        ORDER BY applied_at, migration_id
        """
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migrations", nargs="*", help="SQL migration files in execution order")
    parser.add_argument("--env", action="append", default=[], help="Environment file to load")
    parser.add_argument("--root", default=".", help="Root used for stable migration ids")
    parser.add_argument("--manifest", help="Ordered migration manifest relative to --root")
    parser.add_argument("--status", action="store_true", help="Print the migration ledger")
    return parser


async def async_main(args: argparse.Namespace) -> int:
    for env_path in args.env:
        load_env_file(Path(env_path))

    # Preserve explicit --env/process selection; do not discover another DB file.
    host = os.getenv("DB_HOST", "localhost")
    password = os.getenv("DB_PASSWORD", "")
    ssl_mode = validate_database_security(
        host=host, password=password, ssl_mode=os.getenv("DB_SSLMODE", ""),
    )
    conn = await asyncpg.connect(
        host=host,
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "ostory_db"),
        user=os.getenv("DB_USER", "ostory_user"),
        password=password,
        ssl=ssl_mode,
    )
    try:
        if args.status:
            for row in await list_migrations(conn):
                print(
                    f"{row['migration_id']} {row['checksum_sha256']} "
                    f"{row['applied_at']} {row['execution_ms']}ms {row['git_sha'] or '-'}"
                )
            return 0
        root = Path(args.root)
        paths = read_manifest(Path(args.manifest), root=root) if args.manifest else []
        paths.extend(Path(item) for item in args.migrations)
        if not paths:
            raise ValueError("Provide migrations or --manifest unless --status is used")
        for version, state in await apply_migrations(
            conn,
            paths,
            root=root,
            git_sha=os.getenv("GIT_SHA", ""),
        ):
            print(f"  {state}: {version}")
        return 0
    finally:
        await conn.close()


def main() -> int:
    return asyncio.run(async_main(build_parser().parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
