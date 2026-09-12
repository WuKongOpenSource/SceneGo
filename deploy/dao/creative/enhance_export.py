"""Atomic export of the caller's saved video workspace into the editor."""
import json
import uuid
from db_manager import get_db_manager
from utils.enhance_export import TIMELINE_NAME, decode, plan_export


class EnhanceExportDAO:
    @staticmethod
    async def export(episode_id, user_id):
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                await conn.fetchrow('SELECT episode_id FROM episodes WHERE episode_id=$1 FOR UPDATE', episode_id)
                raw = await conn.fetchval('SELECT config_value FROM system_configs WHERE config_key=$1 FOR SHARE',
                                          f'workspace_session_{user_id}_{episode_id}')
                if raw is None:
                    raise ValueError('视频工作区尚未保存，请重试')
                segments = await conn.fetch('SELECT * FROM video_segments WHERE episode_id=$1 ORDER BY sort_order FOR UPDATE', episode_id)
                files = await conn.fetch("""SELECT f.* FROM files f JOIN video_segments vs ON vs.segment_id=f.entity_id
                    WHERE vs.episode_id=$1 AND f.entity_type='video_segment' AND f.file_role='video'
                    AND f.file_type='video' AND NOT f.is_deleted ORDER BY f.created_at DESC FOR UPDATE OF f""", episode_id)
                tracks = await conn.fetch('SELECT track_id,items FROM timeline_tracks WHERE episode_id=$1 AND track_name=$2 ORDER BY created_at FOR UPDATE', episode_id, TIMELINE_NAME)
                track = tracks[0] if tracks else None
                selected, items = plan_export(decode(raw, {}), [dict(s) for s in segments],
                                              [dict(f) for f in files], decode(track['items'], []) if track else [])
                for order, selection in enumerate(selected):
                    await conn.execute("UPDATE video_segments SET video_url=$2,duration_ms=$3,sort_order=$4 WHERE segment_id=$1",
                                       selection['segment_id'], selection['video_url'], selection['duration_ms'], order)
                    await conn.execute("""UPDATE files SET is_selected=(file_id=$2) WHERE entity_type='video_segment'
                        AND entity_id=$1 AND file_role='video' AND NOT is_deleted""", selection['segment_id'], selection['file_id'])
                if track:
                    await conn.execute('UPDATE timeline_tracks SET items=$2::jsonb WHERE track_id=$1', track['track_id'], json.dumps(items))
                else:
                    await conn.execute("""INSERT INTO timeline_tracks(track_id,episode_id,track_type,track_name,sort_order,items)
                        VALUES($1,$2,'video',$3,0,$4::jsonb)""", f'track_{uuid.uuid4().hex[:12]}', episode_id, TIMELINE_NAME, json.dumps(items))
                return {'success': True, 'count': len(selected), 'segment_ids': [s['segment_id'] for s in selected]}
