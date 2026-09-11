"""Creator-facing identity from the submitted routing choice, not a legacy title."""

def seedance_task_identity(data):
    task_type = str(data.get("task_type") or "")
    if not task_type.startswith("seedance_"):
        return {}
    models = {"agent_plan": ("Seedance15", "Seedance 1.5 Pro"),
              "standard": ("Seedance2", "Seedance 2.0"),
              "fast": ("Seedance2Fast", "Seedance 2.0 Fast"),
              "mini": ("Seedance2Mini", "Seedance 2.0 Mini")}
    sub_model = str(data.get("sub_model") or "")
    choice = models.get(sub_model)
    if choice is None:
        choice = next((value for value in models.values() if value[0] == data.get("model")), None)
    if choice is None:
        return {"provider": "seedance", "category": "video"}
    model, label = choice
    operation = "首尾帧过渡" if "morph" in task_type else "图生视频" if "i2v" in task_type else "视频生成"
    return {"provider": "seedance", "category": "video", "model": model,
            "display_name": f"{label} · {operation}"}
