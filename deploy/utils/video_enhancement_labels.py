"""Project safe processing labels from persisted media provenance."""
import json


def video_enhancement_kinds(metadata):
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return []
    if not isinstance(metadata, dict):
        return []
    params = metadata.get('generation_params')
    records = [metadata, params] if isinstance(params, dict) else [metadata]
    values = {str(record.get(key) or '').strip().lower()
              for record in records for key in ('model', 'task_type', 'requested_workflow_type', 'workflow_name')}
    kinds = []
    # Legacy worker results retain their engine name after verified HD repair.
    timing = metadata.get('timing_contract')
    verified_hd = (isinstance(timing, dict)
                   and isinstance(timing.get('source_duration_ms'), (int, float))
                   and timing['source_duration_ms'] > 0
                   and timing.get('output_duration_ms') == timing['source_duration_ms']
                   and isinstance(timing.get('source_frame_count'), int)
                   and timing['source_frame_count'] > 0
                   and bool(timing.get('source_fps')))
    if verified_hd or values & {'upscale', 'viedo_upscaler', 'video_upscale', 'video-upscale'}:
        kinds.append('upscale')
    if values & {'interpolate', 'video_interpolate', 'frame_interpolation'}:
        kinds.append('interpolate')
    if values & {'video_voice', 'video_infinitetalk', 'lipsync', 'lip_sync'}:
        kinds.append('lipSync')
    return kinds
