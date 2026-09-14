
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from services.seedance_output_contract import seedance_output_resolution
from services.seedance_task_identity import seedance_task_identity


class GenerateRequest(BaseModel):
    @model_validator(mode='before')
    @classmethod
    def validate_seedance_output(cls, values):
        if isinstance(values, dict) and str(values.get('task_type') or '').startswith('seedance_'):
            # Resolve the model-specific default before shared field defaults.
            return {**values, **seedance_task_identity(values), 'resolution': seedance_output_resolution(values.get('resolution'), values.get('sub_model'))}
        return values





    model_config = ConfigDict(extra='allow', protected_namespaces=())

    task_type: str = Field(..., description="i2v, morph, upscale, voice, wan26_i2v, seedance_*, kling_*, vidu_*, happyhorse_r2v")
    model: str = Field("Wan2", description="模型名称")
    prompt: str = Field("", description="提示词")
    prompt_AU: Optional[str] = Field(None, description="配音提示词")
    negative_prompt: str = Field("bad quality", description="负面提示词")
    image_path: Optional[str] = Field(None, description="图片文件路径")
    image_path_end: Optional[str] = Field(None, description="结束帧路径（morph）")
    video_filename: Optional[str] = Field(None, description="视频文件名（upscale/voice）")
    audio_filename: Optional[str] = Field(None, description="音频文件名（voice）")
    target_fps: Optional[int] = Field(60, description="Target frame rate for interpolate tasks")
    seed: int = Field(-1, description="随机种子")
    steps: int = Field(20, description="步数")
    cfg: float = Field(7.5, description="CFG")
    priority: int = Field(2, description="优先级 1-3")

    resolution: Optional[str] = Field("1080P", description="分辨率（720P, 1080P）")
    duration: Optional[int] = Field(5, description="视频时长（5, 10, 15秒）")
    shot_type: Optional[str] = Field("multi", description="镜头类型（multi多镜头, single单镜头）")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    workspace_group_id: Optional[str] = Field(None, description="视频工作台卡片ID，用于刷新后恢复实时任务状态")
    preferred_agent_id: Optional[str] = Field(None, description="指定执行任务的处理节点")
    preferred_node_id: Optional[str] = Field(None, description="指定执行任务的集群节点")

    sub_model: Optional[str] = Field(None, description="Seedance 子型号: standard|fast")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    media_inputs: Optional[List[Dict[str, Any]]] = Field(None, description="Seedance 多模态输入: [{kind:image|video|audio, url, role?, file_id?}]")
    reference_audio_policy: Literal['preserve', 'trim_to_15'] = 'preserve'
    ratio: Optional[str] = Field("adaptive", description="Seedance 画面比例: adaptive|16:9|4:3|1:1|3:4|9:16|21:9")
    watermark: Optional[bool] = Field(False, description="Seedance 水印")
    generate_audio: Optional[bool] = Field(True, description="Seedance AI 配音")
    camera_fixed: Optional[bool] = Field(False, description="Seedance 1.5pro 专用，2.0 系列无效")
    draft_task_id: Optional[str] = Field(None, description="Seedance 1.5pro 样片任务 ID 复用，2.0 不支持")


class DeepseekChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt: str = Field(..., description="要发送给 DeepSeek 的提示词")
    response_format: str = Field("text", pattern="^(text|json)$")
    temperature: float = Field(0.2, ge=0, le=1)
    model: Optional[str] = Field(None, description="DeepSeek model override; omitted uses admin runtime config")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    operation: Optional[str] = Field(None, description="业务操作标识，用于通知展示")
    display_name: Optional[str] = Field(None, description="用户可读的任务名称")
    project_id: Optional[str] = None
    episode_id: Optional[str] = None
    source_page: Optional[str] = None
    source_item_id: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    suppress_notification: bool = Field(False, description="内部重试时保留任务审计但不发送用户通知")


class MinimaxChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt: str = Field(..., description="要发送给 MiniMax M3 的提示词")
    response_format: str = Field("text", pattern="^(text|json)$")
    temperature: float = Field(0.2, ge=0, le=1)
    model: Optional[str] = Field(None, description="MiniMax text operation; omitted uses MiniMax M3")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    operation: Optional[str] = Field(None, description="业务操作标识，用于通知展示")
    display_name: Optional[str] = Field(None, description="用户可读的任务名称")
    project_id: Optional[str] = None
    episode_id: Optional[str] = None
    source_page: Optional[str] = None
    source_item_id: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    suppress_notification: bool = Field(False, description="内部重试时保留任务审计但不发送用户通知")


class ImageReferenceMetadata(BaseModel):
    referenceId: Optional[str] = None
    assetId: Optional[str] = None
    fileId: Optional[str] = None
    type: str = Field("effect", description="character | scene | pose | prop | effect")
    name: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    isLocked: bool = False


class ImageReferenceValidationRequest(BaseModel):
    references: List[str] = Field(default_factory=list, max_length=16)
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    project_id: Optional[str] = None
    episode_id: Optional[str] = None


class DoubaoImageRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt: str
    model: Optional[str] = Field(None, description="Doubao image model override; omitted uses admin runtime config")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    references: List[str] = Field(default_factory=list)
    reference_metadata: List[ImageReferenceMetadata] = Field(default_factory=list)
    seedance_portrait: bool = Field(False, description="Pure text-to-image with original preservation and same-key provenance checks")
    size: str = Field("2K")
    sequential: str = Field("disabled", pattern="^(disabled|auto)$")
    count: int = Field(1, ge=1, le=15)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)
    source_page: Optional[str] = Field(None)
    source_item_id: Optional[str] = Field(None)


class GeminiTextRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt: str
    system_prompt: Optional[str] = None
    temperature: float = Field(1.0, ge=0, le=2)
    model: Optional[str] = Field(None, description="Gemini text model override; omitted uses admin runtime config")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    operation: Optional[str] = Field(None, description="业务操作标识，用于通知展示")
    display_name: Optional[str] = Field(None, description="用户可读的任务名称")
    project_id: Optional[str] = None
    episode_id: Optional[str] = None
    source_page: Optional[str] = None
    source_item_id: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    suppress_notification: bool = Field(False, description="内部重试时保留任务审计但不发送用户通知")


class GeminiImageReferenceMetadata(BaseModel):
    referenceId: Optional[str] = None
    assetId: Optional[str] = None
    fileId: Optional[str] = None
    type: str = Field("effect", description="character | scene | pose | prop | effect")
    name: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    isLocked: bool = False


class GeminiImageRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt: str
    model: Optional[str] = Field(None, description="Gemini image model override; omitted uses admin runtime config")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    references: List[str] = Field(default_factory=list)
    reference_metadata: List[GeminiImageReferenceMetadata] = Field(default_factory=list)
    aspectRatio: str = Field("1:1")
    imageSize: Optional[str] = None
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)
    source_page: Optional[str] = Field(None)
    source_item_id: Optional[str] = Field(None)


class GptImageRequest(BaseModel):









    model_config = ConfigDict(protected_namespaces=())

    prompt: str
    tier: str = Field("vip", description="vip | official")
    model_scope: Optional[str] = Field(None, description="model usage scope: workflow|studio")
    references: List[str] = Field(default_factory=list)
    reference_metadata: List[ImageReferenceMetadata] = Field(default_factory=list)
    size: str = Field("auto", description="1024x1024 / 1536x1024 / auto / etc，由前端按 ratio×K 推荐后透传")
    quality: str = Field("auto", description="auto | low | medium | high")
    n: int = Field(1, ge=1, le=4)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)
    source_page: Optional[str] = Field(None)
    source_item_id: Optional[str] = Field(None)


class ImageGenerationRequest(BaseModel):

    engine: str = "gemini"  # gemini | comfyui
    prompt: str
    negative_prompt: Optional[str] = ""
    ref_images: List[str] = Field(default_factory=list)
    strength: float = 0.75
    seed: int = -1
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    preferred_agent_id: Optional[str] = Field(None, description="指定执行任务的处理节点")
    preferred_node_id: Optional[str] = Field(None, description="指定执行任务的集群节点")


class ComfyUIWorkflowRequest(BaseModel):
    workflow_type: str = Field(..., description="工作流类型: qwen/qwen_lora/kontext")
    prompt: str = Field(..., description="正面提示词")
    negative_prompt: str = Field(default="bad quality, worst quality", description="负面提示词")
    image_filenames: List[str] = Field(..., description="处理节点中的图片文件名列表（1-6张）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    preferred_agent_id: Optional[str] = Field(None, description="指定执行任务的处理节点")
    preferred_node_id: Optional[str] = Field(None, description="指定执行任务的集群节点")
    output_width: Optional[int] = Field(None, ge=64, le=8192, description="目标图像宽度")
    output_height: Optional[int] = Field(None, ge=64, le=8192, description="目标图像高度")


class ComfyUIRoutedRequest(BaseModel):
    preferred_agent_id: Optional[str] = Field(None, description="Preferred processing node")
    preferred_node_id: Optional[str] = Field(None, description="Preferred cluster node")


class AngleAdjustRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="处理节点中的图片文件名")
    prompt: str = Field(..., description="角度调整提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    output_width: Optional[int] = Field(None, ge=64, le=8192, description="保持原图比例的目标宽度")
    output_height: Optional[int] = Field(None, ge=64, le=8192, description="保持原图比例的目标高度")


class HumanMultiAngleRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="处理节点中的图片文件名")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class AroundAngleRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="处理节点中的图片文件名")
    prompt: str = Field(..., description="角度描述提示词，如：front view, eye-level shot, medium shot")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class MattingRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="处理节点中的图片文件名")
    matting_type: str = Field(..., description="抠图类型: subject(主体脱离)/split(主体背景分离)")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class ImageFusionRequest(ComfyUIRoutedRequest):
    fusion_type: str = Field(..., description="融合类型: fusion(图像融合)/transfer(迁移学习)/imitation(模仿学习)")
    image_bk: str = Field(..., description="底图/背景图文件名")
    image_hu: str = Field(..., description="人物图文件名")
    image_mb: Optional[str] = Field(default=None, description="蒙版图文件名（仅迁移学习需要）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class Panorama360Request(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="场景素材图片文件名")
    prompt: str = Field(default="", description="全景描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class PanoramaFusionRequest(ComfyUIRoutedRequest):
    image_1: str = Field(..., description="人物/场景图1文件名")
    image_2: Optional[str] = Field(default=None, description="人物图2文件名（可选）")
    image_3: str = Field(..., description="全景截图背景文件名")
    prompt: str = Field(default="", description="融合提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class AutoStoryboardRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="输入图片文件名")
    prompt: str = Field(..., description="分镜描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class MultiGridStoryboardRequest(ComfyUIRoutedRequest):
    mode: str = Field(..., description="模式: multi_shot(多镜头分镜) / story(故事分镜)")
    user_prompt: str = Field(..., description="用户输入的提示词")
    reference_image: str = Field(..., description="参考图像（Base64格式，必须传入一张）")
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)


class MaterialProcessRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="处理节点中的图片文件名")
    source_file_id: Optional[str] = Field(
        None,
        max_length=128,
        description="原始图片文件 ID，用于历史记录缩略图",
    )
    workflow_type: str = Field(..., description="工作流类型: upscale_hd/image_upscale/remove_watermark/three_view")
    target_long_edge: Optional[int] = Field(
        None,
        ge=4096,
        le=50000,
        description="独立图片放大任务的目标最长边像素",
    )
    dpi: Optional[int] = Field(
        None,
        ge=72,
        le=300,
        description="输出图片 DPI，最高 300",
    )
    text_clarity: bool = Field(
        False,
        description="启用保守的文字边缘增强；不会生成或重写文字",
    )
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
