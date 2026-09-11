from pathlib import Path

from scripts.check_code_comment_language import scan_repository


def _scan(tmp_path: Path, name: str, source: str):
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return scan_repository(tmp_path, [name])


def test_python_comments_and_docstrings_must_use_english(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "example.py",
        '"""模块说明。"""\nvalue = "中文产品文案"  # 行内说明\n',
    )

    assert [(issue.line, issue.kind) for issue in issues] == [
        (1, "docstring"),
        (2, "comment"),
    ]


def test_typescript_scanner_ignores_product_copy_and_checks_template_expressions(
    tmp_path: Path,
) -> None:
    issues = _scan(
        tmp_path,
        "example.tsx",
        "const title = '中文产品文案';\n"
        "const value = `copy ${input /* 模板表达式说明 */}`;\n"
        "const view = <div>{/* 组件说明 */}{title}</div>;\n",
    )

    assert [(issue.line, issue.kind) for issue in issues] == [
        (2, "comment"),
        (3, "comment"),
    ]


def test_configuration_and_sql_inline_comments_are_checked(tmp_path: Path) -> None:
    config_issues = _scan(tmp_path, "service.conf", 'label="中文文案" # 配置说明\n')
    sql_issues = _scan(tmp_path, "schema.sql", "SELECT '中文文案'; -- 查询说明\n")

    assert [(issue.line, issue.kind) for issue in config_issues] == [(1, "comment")]
    assert [(issue.line, issue.kind) for issue in sql_issues] == [(1, "comment")]


def test_html_script_comments_are_checked(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "index.html",
        "<script>\n// 内嵌脚本说明\nconst label = '中文产品文案';\n</script>\n",
    )

    assert [(issue.line, issue.kind) for issue in issues] == [(2, "comment")]


def test_english_comments_pass(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "example.ts",
        "// Explain the boundary.\nconst label = '中文产品文案';\n",
    )

    assert issues == []


def test_decorative_and_file_path_comments_are_rejected(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "example.ts",
        "// src/example.ts\n// =================\n// ─────────\nconst value = 1;\n",
    )

    assert [(issue.line, issue.kind) for issue in issues] == [
        (1, "nonessential comment"),
        (2, "nonessential comment"),
        (3, "nonessential comment"),
    ]


def test_decorated_and_generic_section_headings_are_rejected(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "example.ts",
        "// --- Configuration State ---\n"
        "// Request Management\n"
        "// 🆕 Image Editor State\n"
        "// Material Library State (Global)\n"
        "const value = 1;\n",
    )

    assert [(issue.line, issue.kind) for issue in issues] == [
        (1, "nonessential comment"),
        (2, "nonessential comment"),
        (3, "nonessential comment"),
        (4, "nonessential comment"),
    ]


def test_generated_source_markers_are_preserved(tmp_path: Path) -> None:
    issues = _scan(
        tmp_path,
        "generated.js",
        "// GENERATED from src; do not edit.\n// src/example.ts\nconst value = 1;\n",
    )

    assert issues == []


def test_current_repository_comments_follow_policy() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    issues = scan_repository(repository_root)
    assert issues == [], "\n".join(
        f"{issue.path}:{issue.line} [{issue.kind}]" for issue in issues
    )
