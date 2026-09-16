"""Real SQL contracts; require the explicitly configured isolated test database."""
from types import SimpleNamespace
import pytest

from core.online_provider_task_model import OnlineProviderTask
from dao.business.jimeng_job import JimengJobDAO
from dao.business.task import TaskDAO
from dao.content.content import FileDAO
from services.jimeng_contract import JimengError
from services.jimeng_result_service import attach_generated_result


@pytest.mark.asyncio
async def test_durable_intent_identity_and_terminal_status(test_db):
    task = OnlineProviderTask('task_jimeng_db', 'jimeng_multimodal', {'prompt': 'original'}, user_id='user_dao_fixture')
    config = SimpleNamespace(account_id='123', session_id='456', state_id='independent_fixture')
    await TaskDAO.create_task(task_id=task.task_id, task_type=task.task_type, user_id=task.user_id, task_data=task.data)
    await JimengJobDAO.ensure(task, config)
    assert await JimengJobDAO.mark_processing(task.task_id)
    assert await JimengJobDAO.mark_submitting(task.task_id)
    assert not await JimengJobDAO.mark_submitting(task.task_id)
    await JimengJobDAO.update(task.task_id, stage='submitted', submit_id='provider_id_fixture',
        trace=[{'sha256': 'original'}], provider_credits=30)
    job = await JimengJobDAO.get(task.task_id)
    assert job['submit_id'] == 'provider_id_fixture' and job['input_trace'] == [{'sha256': 'original'}]
    assert job['provider_credit_count'] == 30
    task.data['prompt'] = 'changed'
    with pytest.raises(JimengError):
        await JimengJobDAO.ensure(task, config)
    await TaskDAO.update_task_status(task.task_id, 'completed', result_data={'videos': [{'file_id': 'original_result'}]})
    assert not await JimengJobDAO.mark_processing(task.task_id)
    assert (await TaskDAO.get_task(task.task_id))['status'] == 'completed'


@pytest.mark.asyncio
@pytest.mark.parametrize('late_result', [False, True])
async def test_actual_file_and_segment_binding_never_reselects_recovered_result(test_db, late_result):
    await test_db.execute("""INSERT INTO video_segments(segment_id,episode_id,video_url,input_params)
        VALUES('seg_jimeng_db','ep_1','/storage/manual.mp4','{"duration":3.2,"caption":"keep"}'::jsonb)""")
    data = {'entity_type': 'video_segment', 'entity_id': 'seg_jimeng_db', 'episode_id': 'ep_1'}
    await TaskDAO.create_task(task_id='task_jimeng_db', task_type='jimeng_multimodal',
        user_id='user_dao_fixture', task_data=data)
    if late_result:
        await test_db.execute("UPDATE tasks SET created_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE task_id='task_jimeng_db'")
        await TaskDAO.create_task(task_id='task_jimeng_newer', task_type='seedance_multi', user_id='user_dao_fixture', task_data=data)
    await FileDAO.create_file(version_id=None, user_id='user_dao_fixture', file_id='file_jimeng_db', file_type='video',
        file_name='test.mp4', file_path='/synthetic/test.mp4', file_url='/storage/test.mp4',
        file_size_bytes=100,
        metadata={'source': 'jimeng'}, entity_type='video_segment', entity_id='seg_jimeng_db', file_role='video',
        project_id='proj_1', episode_id='ep_1', source='jimeng')
    from db_manager import get_db_manager
    selected = await attach_generated_result(get_db_manager(), 'seg_jimeng_db', 'ep_1',
        'task_jimeng_db', 'file_jimeng_db', '/storage/test.mp4', 5088)
    assert selected is (not late_result)
    row = await test_db.fetchrow("SELECT video_url,input_params->>'caption' AS caption,input_params->>'duration' AS duration FROM video_segments WHERE segment_id='seg_jimeng_db'")
    assert row['video_url'] == ('/storage/manual.mp4' if late_result else '/storage/test.mp4')
    assert row['caption'] == 'keep' and row['duration'] == '3.2'
    await test_db.execute("UPDATE files SET is_selected=FALSE WHERE file_id='file_jimeng_db'")
    await test_db.execute("UPDATE video_segments SET video_url='/storage/new-choice.mp4' WHERE segment_id='seg_jimeng_db'")
    await attach_generated_result(get_db_manager(), 'seg_jimeng_db', 'ep_1',
        'task_jimeng_db', 'file_jimeng_db', '/storage/test.mp4', 5088)
    assert await test_db.fetchval("SELECT video_url FROM video_segments WHERE segment_id='seg_jimeng_db'") == '/storage/new-choice.mp4'
    assert not await test_db.fetchval("SELECT is_selected FROM files WHERE file_id='file_jimeng_db'")
