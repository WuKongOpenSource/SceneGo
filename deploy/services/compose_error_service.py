"""Client-safe composition errors; raw diagnostics belong only in server logs."""
import errno

_FALLBACK = '合成未完成，请重试；若仍失败，请联系管理员。'
_MESSAGES = (
    '成片保存失败，请稍后重试；若仍失败，请联系管理员。',
    '成片存储空间不足，请联系管理员后重试。',
    '部分视频素材无法读取，请重新选择或上传后重试。',
    '源视频已变化，请重新导入美化后重试。',
    '裁剪范围超出视频时长，请调整片段长度后重试。',
    '配音素材缺失，请重新保存配音后重试。',
    '时间线上没有可合成的视频片段。',
    '字幕合成失败，请检查字幕设置后重试。',
    '音频混合失败，请检查音乐和音效素材后重试。',
)


def public_compose_error(error) -> str:
    message = str(error or '')
    if message in (*_MESSAGES, _FALLBACK):
        return message
    if isinstance(error, OSError):
        return _MESSAGES[1] if error.errno == errno.ENOSPC else _MESSAGES[0]
    # Return only static text, never excerpts of paths, identifiers or stderr.
    for markers, safe in (
        (('源视频时长已变化', '源视频已变化'), _MESSAGES[3]),
        (('超出源视频', '裁剪范围超出'), _MESSAGES[4]),
        (('源视频文件不存在', '视频源不存在', '源视频无法读取'), _MESSAGES[2]),
        (('配音文件缺失',), _MESSAGES[5]),
        (('没有可合成的视频', 'No video segments'), _MESSAGES[6]),
        (('Subtitle burn-in failed',), _MESSAGES[7]),
        (('Global audio mix failed',), _MESSAGES[8]),
    ):
        if any(marker in message for marker in markers):
            return safe
    return _FALLBACK
