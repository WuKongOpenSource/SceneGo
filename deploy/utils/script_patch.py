"""Line-oriented structured patches for script review."""
from __future__ import annotations

import difflib
import hashlib
from typing import Any, Dict


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def build_script_patch(base_content: str, candidate_content: str) -> Dict[str, Any]:
    """Return a stable, JSON-serializable patch without applying it."""
    base_lines = str(base_content or "").splitlines()
    candidate_lines = str(candidate_content or "").splitlines()
    matcher = difflib.SequenceMatcher(a=base_lines, b=candidate_lines, autojunk=False)
    operations: list[Dict[str, Any]] = []
    counts = {"added": 0, "deleted": 0, "changed": 0}
    for tag, base_start, base_end, candidate_start, candidate_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        before = base_lines[base_start:base_end]
        after = candidate_lines[candidate_start:candidate_end]
        if tag == "insert":
            counts["added"] += len(after)
        elif tag == "delete":
            counts["deleted"] += len(before)
        else:
            counts["changed"] += max(len(before), len(after))
        operations.append(
            {
                "op": {"insert": "add", "delete": "delete", "replace": "change"}[tag],
                "baseStart": base_start + 1,
                "baseEnd": base_end,
                "candidateStart": candidate_start + 1,
                "candidateEnd": candidate_end,
                "before": before,
                "after": after,
            }
        )
    return {
        "format": "ostory-script-patch-v1",
        "baseHash": _hash(str(base_content or "")),
        "candidateHash": _hash(str(candidate_content or "")),
        "summary": {**counts, "operationCount": len(operations)},
        "operations": operations,
    }
