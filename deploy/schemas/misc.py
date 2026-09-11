
from pydantic import BaseModel, Field


class PromptTemplate(BaseModel):

    template_type: str = Field(..., description="模板类型: rewrite/storyboard")
    content: str = Field(..., description="提示词内容")
