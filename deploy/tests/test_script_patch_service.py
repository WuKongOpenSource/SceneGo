from utils.script_patch import build_script_patch


def test_build_script_patch_reports_add_delete_and_change_without_applying():
    patch = build_script_patch(
        "第一行\n需要删除\n旧对白",
        "第一行\n新对白\n新增结尾",
    )

    assert patch["format"] == "ostory-script-patch-v1"
    assert patch["baseHash"] != patch["candidateHash"]
    assert patch["summary"]["operationCount"] >= 1
    assert patch["summary"]["changed"] >= 2
    assert patch["operations"][0]["before"] == ["需要删除", "旧对白"]
    assert patch["operations"][0]["after"] == ["新对白", "新增结尾"]


def test_identical_script_has_empty_patch():
    patch = build_script_patch("不变", "不变")
    assert patch["summary"] == {
        "added": 0,
        "deleted": 0,
        "changed": 0,
        "operationCount": 0,
    }
    assert patch["operations"] == []
