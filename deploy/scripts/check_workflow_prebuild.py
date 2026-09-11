#!/usr/bin/env python3
"""Check ComfyUI workflow prebuild readiness without requiring a GPU.

This script validates the server-side contract used by the external GPU
agent:

1. Workflow templates can be loaded and transformed into executable
   workflow_json.
2. Important placeholders are replaced in executable node inputs.
3. TaskService.submit(..., prepare=True) attaches workflow_json,
   workflow_name, and agent_files before enqueue.
4. Known incomplete templates fail before enqueue with a clear error.

It is intentionally lightweight and can run in a local dev environment. If
FastAPI is not installed locally, a tiny HTTPException stub is injected before
importing TaskService.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import types
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _ensure_fastapi_stub() -> None:
    try:
        import fastapi  # noqa: F401
    except ModuleNotFoundError:
        fastapi_stub = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code: int = 500, detail: Any = None):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        fastapi_stub.HTTPException = HTTPException
        sys.modules["fastapi"] = fastapi_stub


def _executable_node_count(workflow: dict[str, Any]) -> int:
    return sum(
        1
        for node in workflow.values()
        if isinstance(node, dict)
        and node.get("class_type")
        and node.get("class_type") != "placeholder_node"
    )


def _executable_inputs_as_json(workflow: dict[str, Any]) -> str:
    values: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, str):
            values.append(value)

    for node in workflow.values():
        if (
            isinstance(node, dict)
            and node.get("class_type")
            and node.get("class_type") != "placeholder_node"
        ):
            walk(node.get("inputs", {}))

    return json.dumps(values, ensure_ascii=False)


def check_workflow_handler() -> None:
    from pipeline import workflow_handler as workflow_handler_module

    workflow_handler_module._workflow_handler = None
    handler = workflow_handler_module.get_workflow_handler()
    print(f"workflow_dir={handler.workflow_dir}")

    cases: list[tuple[str, dict[str, Any], bool]] = [
        ("i2i_fj", {"image_path": "sample.png", "uploaded_image": "sample.png", "prompt": "front view", "seed": 1}, True),
        ("i2i_around", {"image_path": "sample.png", "uploaded_image": "sample.png", "prompt": "front view", "seed": 1}, True),
        ("i2i_human", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed": 1}, True),
        ("upscale_hd", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed_0": 123456}, True),
        ("remove_watermark", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed": 1}, True),
        ("matting_subject", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed": 1}, False),
        ("matting_split", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed": 1}, False),
        ("image_fusion", {"image_BK": "bk.png", "image_HU": "hu.png", "uploaded_image_BK": "bk.png", "uploaded_image_HU": "hu.png", "seed": 1}, False),
        ("image_transfer", {"image_BK": "bk.png", "image_HU": "hu.png", "image_MB": "mb.png", "uploaded_image_BK": "bk.png", "uploaded_image_HU": "hu.png", "uploaded_image_MB": "mb.png", "seed": 1}, False),
        ("pose_imitation", {"image_BK": "bk.png", "image_HU": "hu.png", "uploaded_image_BK": "bk.png", "uploaded_image_HU": "hu.png", "seed": 1}, False),
        ("panorama_360", {"image_path": "sample.png", "uploaded_image": "sample.png", "prompt": "panorama room", "seed": 1}, False),
        ("panorama_fusion_1", {"image_path_1": "a.png", "uploaded_image_1": "a.png", "prompt": "fusion", "seed": 1}, False),
        ("qwen_1", {"image_path_1": "a.png", "uploaded_image_1": "a.png", "prompt": "make image", "seed": 1}, True),
        ("qwen_lora_1", {"image_path_1": "a.png", "uploaded_image_1": "a.png", "prompt": "make image", "seed": 1}, True),
        ("qwenN_lora_1", {"image_path_1": "a.png", "uploaded_image_1": "a.png", "prompt": "make image", "seed": 1}, False),
        ("qwenN_1", {"image_path_1": "a.png", "uploaded_image_1": "a.png", "prompt": "make image", "seed": 1}, True),
        ("three_view", {"image_path": "sample.png", "uploaded_image": "sample.png", "seed": 1}, False),
    ]

    placeholders = [
        "{image}",
        "{image_1}",
        "{image_BK}",
        "{image_HU}",
        "{image_MB}",
        "{prompt}",
        "{seed}",
        "{seed_0}",
    ]

    failures: list[str] = []
    for task_type, data, should_pass in cases:
        try:
            workflow = handler.build_workflow_for_task(task_type, dict(data))
            node_count = _executable_node_count(workflow)
            total_count = len(workflow)
            executable_inputs = _executable_inputs_as_json(workflow)
            unresolved = sorted({part for part in placeholders if part in executable_inputs})
            print(f"{task_type}: OK nodes={node_count} total={total_count} unresolved={unresolved}")
            if not should_pass:
                failures.append(f"{task_type}: expected failure but passed")
            if node_count <= 0 or node_count != total_count or unresolved:
                failures.append(
                    f"{task_type}: invalid prebuild nodes={node_count} total={total_count} unresolved={unresolved}"
                )
        except Exception as exc:
            print(f"{task_type}: ERR {exc}")
            if should_pass:
                failures.append(f"{task_type}: unexpected failure: {exc}")

    if failures:
        raise SystemExit("workflow handler check failed:\n" + "\n".join(failures))

    print("WORKFLOW_HANDLER_CHECK_PASS")


class FakeRedis:
    async def get(self, key: str) -> None:
        return None


class FakeQueue:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    async def enqueue(self, task: Any) -> bool:
        self.tasks.append(task)
        return True


async def check_task_service() -> None:
    _ensure_fastapi_stub()

    logging.getLogger("services.task_service").setLevel(logging.CRITICAL)
    from services.task_service import TaskService

    service = TaskService(FakeRedis())
    service.queue = FakeQueue()

    cases: list[tuple[str, dict[str, Any], int]] = [
        ("i2i_fj", {"image_path": "sample.png", "prompt": "front view", "seed": 1}, 1),
        ("upscale_hd", {"image_path": "sample.png", "seed_0": 123456}, 1),
        ("remove_watermark", {"image_path": "sample.png", "seed": 1}, 1),
        (
            "qwen_2",
            {
                "image_path_1": "bk.png",
                "image_path_2": "hu.png",
                "prompt": "fusion",
                "requested_workflow_type": "image_fusion",
                "gpu2_operation": "image_fusion",
                "seed": 1,
            },
            2,
        ),
        ("qwen_lora_1", {"image_path_1": "a.png", "prompt": "make image", "seed": 1}, 1),
    ]

    for task_type, data, expected_files in cases:
        task_id = await service.submit(task_type, data, "tester")
        task = service.queue.tasks[-1]
        has_workflow_json = bool(task.data.get("workflow_json"))
        workflow_name = task.data.get("workflow_name")
        file_count = len(task.data.get("agent_files", []))
        print(
            f"{task_type}: task_id={task_id} workflow_name={workflow_name} "
            f"workflow_json={has_workflow_json} files={file_count}"
        )
        if not has_workflow_json or not workflow_name:
            raise SystemExit(f"{task_type}: missing prepared workflow fields")
        if file_count != expected_files:
            raise SystemExit(f"{task_type}: expected {expected_files} agent files, got {file_count}")

    before = len(service.queue.tasks)
    try:
        await service.submit("three_view", {"image_path": "sample.png", "seed": 1}, "tester")
    except BaseException as exc:
        print(f"three_view: expected_error={getattr(exc, 'detail', str(exc))}")
    else:
        raise SystemExit("three_view: expected prebuild failure")

    if len(service.queue.tasks) != before:
        raise SystemExit("three_view: was enqueued despite prebuild failure")

    print("TASK_SERVICE_CHECK_PASS")


def main() -> None:
    check_workflow_handler()
    asyncio.run(check_task_service())
    print("WORKFLOW_PREBUILD_CHECK_PASS")


if __name__ == "__main__":
    main()
