from datetime import datetime, timedelta, timezone

from dao.admin.admin_stats import AdminStatsDAO


def test_build_task_log_preserves_video_fields():
    created_at = datetime(2026, 6, 20, 10, 0, 0, tzinfo=timezone.utc)
    completed_at = created_at + timedelta(milliseconds=2500)

    log = AdminStatsDAO._build_task_log(
        {
            "task_id": "task_1",
            "user_id": "user_1",
            "username": "Yuan",
            "status": "completed",
            "created_at": created_at,
            "completed_at": completed_at,
            "task_type": "minimax_i2v",
            "task_data": '{"prompt": "camera move"}',
            "result_data": '{"videos": [{"url": "/static/result.mp4"}]}',
        }
    )

    assert log["id"] == "video_task_1"
    assert log["userId"] == "user_1"
    assert log["username"] == "Yuan"
    assert log["type"] == "video"
    assert log["model"] == "minimax-i2v"
    assert log["status"] == "success"
    assert log["prompt"] == "camera move"
    assert log["params"] == '{"workflow": "minimax_i2v"}'
    assert log["executionTimeMs"] == 2500
    assert log["resultVideo"] == "/static/result.mp4"
    assert log["resultPreview"] is None
    assert log["resultText"] is None


def test_build_legacy_project_logs_preserves_storyboard_and_image_entries():
    updated_at = datetime(2026, 6, 20, 10, 0, 0, tzinfo=timezone.utc)

    logs = AdminStatsDAO._build_legacy_project_logs(
        [
            {
                "project_id": "proj_1",
                "user_id": "user_1",
                "username": "Yuan",
                "updated_at": updated_at,
                "storyboard": {
                    "items": [
                        {
                            "id": "shot_1",
                            "scriptSegment": "hello world",
                            "imagePrompt": "wide frame",
                            "generatedImages": [
                                {"url": "/static/shot.png", "timestamp": 123456}
                            ],
                        }
                    ]
                },
            }
        ]
    )

    assert [log["type"] for log in logs] == ["text", "image"]
    assert logs[0]["id"] == "text_proj_1_shot_1"
    assert logs[0]["model"] == "gemini-2.5-flash"
    assert logs[0]["prompt"] == "hello world"
    assert logs[1]["id"] == "img_proj_1_shot_1_0"
    assert logs[1]["model"] == "gemini-2.5-flash-image"
    assert logs[1]["prompt"] == "wide frame"
    assert logs[1]["resultPreview"] == "/static/shot.png"
    assert logs[1]["timestamp"] == 123456
