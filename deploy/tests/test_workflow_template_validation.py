import json
import sys
from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from services.workflow_template_validation import (
    INVALID_WORKFLOW_MARKER,
    workflow_executable_node_count,
    workflow_invalid_reason,
    workflow_is_executable,
)


def test_empty_workflow_is_invalid():
    assert workflow_invalid_reason({}) == "workflow JSON is empty"
    assert workflow_executable_node_count({}) == 0


def test_replacement_marker_is_invalid_even_inside_real_node():
    workflow = {
        "1": {
            "class_type": "KSampler",
            "inputs": {"prompt": f"{INVALID_WORKFLOW_MARKER}: panorama"},
        }
    }

    assert "invalid marker" in workflow_invalid_reason(workflow)
    assert workflow_is_executable(workflow) is False


def test_placeholder_node_is_invalid_even_with_real_nodes():
    workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "{image}"}},
        "2": {"class_type": "PlaceholderNode", "inputs": {}},
    }

    assert workflow_invalid_reason(workflow) == "workflow contains PlaceholderNode"
    assert workflow_executable_node_count(workflow) == 0


def test_valid_workflow_accepts_decoded_json_strings():
    workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "{image}"}},
        "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
    }

    serialized = json.dumps(workflow)
    assert workflow_invalid_reason(serialized) is None
    assert workflow_executable_node_count(serialized) == 2
    assert workflow_is_executable(serialized) is True
