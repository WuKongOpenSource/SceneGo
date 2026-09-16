"""H3 Ref2VA is an explicit contract, never a fallback to FL2VA."""
import re


def validate_h3_reference(data: dict) -> None:
    mode = data.get("h3_reference_mode") or "first_last"
    if mode not in {"first_last", "reference"}:
        raise ValueError("未知的 H3 参考模式")
    if mode != "reference":
        if data.get("h3_reference_images"):
            raise ValueError("H3 多图参考图片必须使用多图参考模式")
        return
    if data.get("model") != "MiniMaxH3" or data.get("task_type") != "i2v":
        raise ValueError("H3 多图参考仅支持标准 MiniMax H3 图生视频")
    if any(data.get(key) for key in ("h3_long_video", "h3_sage_attention", "h3_low_vram", "image_path", "image_path_end", "media_inputs")):
        raise ValueError("H3 多图参考不能混用首尾帧、长视频、Fast 或 Mini 参数")
    images = data.get("h3_reference_images")
    if not isinstance(images, list) or not 1 <= len(images) <= 9:
        raise ValueError("H3 多图参考需要 1–9 张原图")
    for index, image in enumerate(images, 1):
        if not isinstance(image, str) or not image.strip() or image != image.strip() or image.lower().startswith(("blob:", "data:", "asset:")):
            raise ValueError(f"H3 图片{index}缺少可用原图地址")
    if len(set(images)) != len(images):
        raise ValueError("H3 参考图片重复，请移除重复引用")
    prompt = str(data.get("prompt") or "")
    for match in re.finditer(r"<Picture\s+(\d+)>", prompt, re.I):
        if not 1 <= int(match[1]) <= len(images):
            raise ValueError(f"H3 图片{match[1]}不存在，请重新关联图片")
    if re.search(r"<(?:Video|Audio)\s+\d+>", prompt, re.I):
        raise ValueError("H3 多图参考目前仅支持图片")
