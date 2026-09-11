
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    remember: bool = False
    captcha_verification: Optional[str] = Field(default=None, max_length=8192)
