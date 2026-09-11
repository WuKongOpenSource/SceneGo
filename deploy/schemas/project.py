
import uuid
from typing import Optional, List
from pydantic import BaseModel, Field


class ProjectData(BaseModel):

    project_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    user_id: Optional[str] = None

    original_content: Optional[str] = None
    script_content: Optional[str] = None
    storyboard: Optional[dict] = None
    extracted_characters: List[str] = Field(default_factory=list)
    extracted_scenes: List[str] = Field(default_factory=list)

    material_selections: Optional[dict] = None
    material_library: Optional[dict] = None

    generated_images: Optional[dict] = None
    generation_engine: Optional[str] = "gemini"  # gemini | comfyui

    video_tasks: Optional[List[dict]] = None

    versions: Optional[List[dict]] = Field(default_factory=list)

    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    stage: int = 1


class ExportToVideoRequest(BaseModel):

    selected_items: List[str]
