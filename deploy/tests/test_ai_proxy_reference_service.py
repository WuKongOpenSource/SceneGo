import base64

import pytest

from services.ai_proxy_reference_service import (
    ReferenceImageError,
    build_reference_snapshot,
    enhance_reference_prompt,
    prepare_doubao_reference_inputs,
    prepare_gemini_image_parts,
    prepare_gpt_image_reference_inputs,
)


class _Logger:
    infos = []
    warnings = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


def setup_function():
    _Logger.infos = []
    _Logger.warnings = []


def test_enhance_reference_prompt_keeps_plain_prompt_without_references():
    assert enhance_reference_prompt("draw a robot", 0) == "draw a robot"


def test_reference_snapshot_preserves_binding_identity_and_redacts_inline_payload():
    snapshot = build_reference_snapshot(
        ["data:image/png;base64,AAAA", "/storage/scene.png"],
        [
            {
                "referenceId": "ref-character",
                "assetId": "asset-character",
                "fileId": "file-character",
                "type": "character",
                "source": "identity_anchor",
                "isLocked": True,
            },
            {"assetId": "asset-scene", "type": "scene"},
        ],
    )

    assert snapshot[0]["reference_uri"] == "inline:data"
    assert snapshot[0]["content_sha256"]
    assert snapshot[0]["asset_id"] == "asset-character"
    assert snapshot[0]["entity_file_id"] == "file-character"
    assert snapshot[0]["locked"] is True
    assert snapshot[0]["submitted"] is False
    assert snapshot[1]["reference_uri"] == "/storage/scene.png"


def test_prepare_gemini_image_parts_accepts_data_url_reference():
    snapshot = []
    parts = prepare_gemini_image_parts(
        prompt="draw a robot",
        references=["data:image/png;base64,AAAA"],
        reference_metadata=[{"assetId": "asset-1", "type": "character"}],
        reference_snapshot=snapshot,
        logger=_Logger,
    )

    assert parts[1] == {"inlineData": {"mimeType": "image/png", "data": "AAAA"}}
    assert "参考图1" in parts[-1]["text"]
    assert "draw a robot" in parts[-1]["text"]
    assert snapshot[0]["asset_id"] == "asset-1"
    assert snapshot[0]["submitted"] is True


def test_prepare_gemini_image_parts_reads_storage_reference(tmp_path):
    image_path = tmp_path / "ref.jpg"
    image_path.write_bytes(b"image-bytes")

    parts = prepare_gemini_image_parts(
        prompt="draw",
        references=["/storage/ref.jpg"],
        logger=_Logger,
        storage_path_resolver=lambda _: image_path,
    )

    assert parts[0]["inlineData"]["mimeType"] == "image/jpeg"
    assert parts[0]["inlineData"]["data"] == base64.b64encode(b"image-bytes").decode("utf-8")
    assert _Logger.infos


def test_prepare_gemini_image_parts_accepts_absolute_same_origin_storage_url(tmp_path):
    image_path = tmp_path / "character.png"
    image_path.write_bytes(b"character-image")
    resolved = []

    parts = prepare_gemini_image_parts(
        prompt="draw",
        references=["https://app.example.test/storage/assets/character.png?version=2"],
        reference_metadata=[{
            "type": "character",
            "name": "主角",
            "source": "identity_anchor",
            "isLocked": True,
        }],
        logger=_Logger,
        storage_path_resolver=lambda path: resolved.append(path) or image_path,
    )

    assert resolved == ["/storage/assets/character.png"]
    assert parts[1]["inlineData"]["data"] == base64.b64encode(b"character-image").decode("utf-8")


def test_prepare_gemini_image_parts_preserves_reference_roles_and_all_six_images():
    references = [f"data:image/png;base64,REF{index}" for index in range(6)]
    metadata = [
        {
            "type": "character" if index == 0 else "prop",
            "name": "主角" if index == 0 else f"道具{index}",
            "source": "identity_anchor" if index == 0 else "material_binding",
            "isLocked": index == 0,
        }
        for index in range(6)
    ]

    parts = prepare_gemini_image_parts(
        prompt="主角坐在教室里",
        references=references,
        reference_metadata=metadata,
        logger=_Logger,
    )

    assert sum("inlineData" in part for part in parts) == 6
    assert parts[0]["text"].startswith("参考图1：角色身份锚点（最高优先级）【主角】")
    assert parts[1]["inlineData"]["data"] == "REF0"
    assert "生成的是参考图中的同一角色" in parts[-1]["text"]
    assert "参考图6" in parts[-1]["text"]


def test_prepare_gemini_image_parts_rejects_missing_locked_character_reference(tmp_path):
    missing = tmp_path / "missing.png"

    try:
        prepare_gemini_image_parts(
            prompt="draw",
            references=["/storage/missing.png"],
            reference_metadata=[{
                "type": "character",
                "name": "主角",
                "source": "identity_anchor",
                "isLocked": True,
            }],
            logger=_Logger,
            storage_path_resolver=lambda _: missing,
        )
    except ReferenceImageError as exc:
        assert "主角" in str(exc)
        assert "无法读取" in str(exc)
    else:
        raise AssertionError("missing locked character reference must fail")


def test_prepare_gpt_image_reference_inputs_accepts_data_and_storage_refs(tmp_path):
    storage_image = tmp_path / "source.jpg"
    storage_image.write_bytes(b"storage-image")

    refs = [
        "data:image/jpeg;base64,YWJj",
        "/storage/source.jpg",
    ]

    snapshot = []
    inputs = prepare_gpt_image_reference_inputs(
        refs,
        reference_metadata=[{"assetId": "asset-a"}, {"assetId": "asset-b"}],
        reference_snapshot=snapshot,
        logger=_Logger,
        storage_path_resolver=lambda _: storage_image,
    )

    assert len(inputs) == 2
    assert inputs[0].filename == "ref_0.jpeg"
    assert inputs[0].content == b"abc"
    assert inputs[0].mime_type == "image/jpeg"
    assert inputs[1].filename == "ref_1.jpeg"
    assert inputs[1].content == b"storage-image"
    assert inputs[1].mime_type == "image/jpeg"
    assert [item["asset_id"] for item in snapshot] == ["asset-a", "asset-b"]
    assert all(item["submitted"] for item in snapshot)


def test_prepare_gpt_image_reference_inputs_skips_invalid_refs():
    inputs = prepare_gpt_image_reference_inputs(
        ["data:image/png;base64,abc", "not-a-reference"],
        logger=_Logger,
    )

    assert inputs == []
    assert _Logger.warnings


def test_prepare_doubao_reference_inputs_accepts_bounded_data_storage_and_remote(tmp_path):
    storage_image = tmp_path / "source.webp"
    storage_image.write_bytes(b"storage-image")
    snapshot = []
    result = prepare_doubao_reference_inputs(
        [
            "data:image/png;base64,YWJj",
            "/storage/source.webp",
            "https://cdn.example.test/image.png",
            "invalid",
        ],
        reference_metadata=[
            {"assetId": "a"},
            {"assetId": "b"},
            {"assetId": "c"},
            {"assetId": "skip"},
        ],
        reference_snapshot=snapshot,
        storage_path_resolver=lambda _: storage_image,
    )

    assert result == [
        "data:image/png;base64,YWJj",
        f"data:image/webp;base64,{base64.b64encode(b'storage-image').decode('ascii')}",
        "https://cdn.example.test/image.png",
    ]
    assert [item["asset_id"] for item in snapshot] == ["a", "b", "c"]


@pytest.mark.parametrize(
    "prepare",
    [
        lambda path: prepare_gemini_image_parts(
            prompt="draw",
            references=["/storage/large.png"],
            logger=_Logger,
            max_bytes=3,
            storage_path_resolver=lambda _: path,
        ),
        lambda path: prepare_gpt_image_reference_inputs(
            ["/storage/large.png"],
            logger=_Logger,
            max_bytes=3,
            storage_path_resolver=lambda _: path,
        ),
        lambda path: prepare_doubao_reference_inputs(
            ["/storage/large.png"],
            max_bytes=3,
            storage_path_resolver=lambda _: path,
        ),
    ],
)
def test_reference_preparation_never_reads_oversized_local_file(tmp_path, monkeypatch, prepare):
    image_path = tmp_path / "large.png"
    image_path.write_bytes(b"too-large")
    read_called = False

    def forbidden_read(self):
        nonlocal read_called
        read_called = True
        raise AssertionError("oversized file must be rejected before read")

    monkeypatch.setattr(type(image_path), "read_bytes", forbidden_read)
    result = prepare(image_path)

    assert read_called is False
    assert result == [{"text": "draw"}] or result == []
