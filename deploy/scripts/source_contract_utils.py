"""Syntax helpers shared by source checks without importing a runtime catalog."""
import ast


def has_imported_call(tree: ast.Module, module: str, symbol: str) -> bool:
    """Check delegation without depending on import order or argument spelling."""
    names = {
        alias.asname or alias.name
        for node in tree.body
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module == module
        for alias in node.names
        if alias.name == symbol
    }
    return any(
        isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in names
        for node in ast.walk(tree)
    )
