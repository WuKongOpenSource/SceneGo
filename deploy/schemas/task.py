
from typing import Optional, List
from pydantic import BaseModel


class WorkspaceSessionRequest(BaseModel):

    task_groups: List[dict]  # TaskManager.taskGroups
    uploaded_images: List[dict]  # TaskManager.uploadedImages
    image_prompts: dict  # TaskManager.imagePrompts
    tasks_status: Optional[dict] = None
    seedance_params: Optional[dict] = None
    dashscope_params: Optional[dict] = None
    storyboard_meta: Optional[dict] = None
    scope: Optional[str] = None
