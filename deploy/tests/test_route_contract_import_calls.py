"""Service-delegation gates inspect syntax, not formatting or quoted examples."""
import ast

import pytest

from scripts.source_contract_utils import has_imported_call


@pytest.mark.parametrize("source", [
    "from example.service import save\nsave(data)",
    "from example.service import Forbidden, save\nsave(data)",
    "from example.service import (\n    Forbidden,\n    save,\n)\nsave(data)",
    "from example.service import save as persist\npersist(data)",
    "from example.service import save\nasync def handle():\n    return await save(row.get('settings'))",
])
def test_imported_call_accepts_equivalent_import_forms(source):
    assert has_imported_call(ast.parse(source), "example.service", "save")


@pytest.mark.parametrize("source", [
    "# from example.service import save\nsave(data)",
    "'from example.service import save'\nsave(data)",
    "from unrelated.service import save\nsave(data)",
    "from .example.service import save\nsave(data)",
    "from example.service import save\n# save(data)",
    "from example.service import save\n'save(data)'",
    "from example.service import save as persist\nsave(data)",
    "from example.service import *\nsave(data)",
    "from example.service import save",
])
def test_imported_call_rejects_missing_delegation_and_text_only_examples(source):
    assert not has_imported_call(ast.parse(source), "example.service", "save")
