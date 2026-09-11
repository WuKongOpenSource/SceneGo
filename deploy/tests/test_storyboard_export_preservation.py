import pytest

from dao.creative.storyboard import (
    StoryboardDAO,
    _prepare_storyboard_items_for_export,
)


def test_prepare_storyboard_items_for_export_preserves_id_and_image_by_sort_order():
    existing_rows = [
        {
            "item_id": "sb_old_0",
            "sort_order": 0,
            "generated_image_url": "/storage/old-0.webp",
        },
        {
            "item_id": "sb_old_1",
            "sort_order": 1,
            "generated_image_url": "/storage/old-1.webp",
        },
    ]

    prepared = _prepare_storyboard_items_for_export(
        existing_rows,
        [
            {"sort_order": 0, "dialogue": "new 0"},
            {"sort_order": 1, "generated_image_url": "/storage/incoming.webp"},
        ],
    )

    assert prepared[0]["_preserved_item_id"] == "sb_old_0"
    assert prepared[0]["generated_image_url"] == "/storage/old-0.webp"
    assert prepared[1]["_preserved_item_id"] == "sb_old_1"
    assert prepared[1]["generated_image_url"] == "/storage/incoming.webp"


def test_prepare_storyboard_items_for_export_prefers_segment_match():
    existing_rows = [
        {
            "item_id": "sb_by_sort",
            "sort_order": 0,
            "script_segment_id": "seg_a",
            "source_video_shot_no": "1",
        },
        {
            "item_id": "sb_by_segment",
            "sort_order": 1,
            "script_segment_id": "seg_b",
            "source_video_shot_no": "2",
        },
    ]

    prepared = _prepare_storyboard_items_for_export(
        existing_rows,
        [
            {
                "sort_order": 0,
                "script_segment_id": "seg_b",
                "source_video_shot_no": "2",
            }
        ],
    )

    assert prepared[0]["_preserved_item_id"] == "sb_by_segment"


@pytest.mark.asyncio
async def test_batch_create_transactional_writes_preserved_id_and_generated_image_url():
    class FakeConn:
        def __init__(self):
            self.calls = []

        async def execute(self, query, *args):
            self.calls.append((query, args))
            return "INSERT 0 1"

    conn = FakeConn()

    created = await StoryboardDAO.batch_create_transactional(
        conn,
        "ep_1",
        [
            {
                "_preserved_item_id": "sb_keep",
                "lineage_id": "line_keep",
                "sort_order": 0,
                "generated_image_url": "/storage/keep.webp",
            }
        ],
        script_id="script_1",
    )

    assert created == 1
    query, args = conn.calls[0]
    assert "generated_image_url" in query
    assert "lineage_id" in query
    assert args[0] == "sb_keep"
    assert args[1] == "line_keep"
    assert args[-1] == "/storage/keep.webp"
