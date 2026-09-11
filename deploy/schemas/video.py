
from typing import Optional, List
from pydantic import BaseModel


class CropVideoRequest(BaseModel):
    video_filename: str
    start_time: float = 0
    end_time: float = 5


class SaveVideoTaskRequest(BaseModel):

    uuid: str
    task_id: str
    task_type: str
    prompt: str
    videos: List[dict]  # [{"url": "...", "filename": "..."}]
    status: str = "completed"
    generate_time: Optional[int] = None
