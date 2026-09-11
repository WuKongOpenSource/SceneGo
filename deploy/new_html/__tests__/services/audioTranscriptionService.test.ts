import { beforeEach, expect, it, vi } from 'vitest';
import { apiJson } from '../../services/httpClient';
import { transcribeTimelineAudio } from '../../services/audioTranscriptionService';
vi.mock('../../services/httpClient',()=>({apiJson:vi.fn()}));
const clip={clipId:'v1',audioUrl:'/storage/v.mp4',mediaKind:'video' as const,sourceOffsetMs:200,durationMs:1000};
beforeEach(()=>vi.clearAllMocks());
it('sends crop offsets and cancellation signal and accepts verified timestamps',async()=>{
  vi.mocked(apiJson).mockResolvedValue({subtitles:[{clip_id:'v1',start_ms:100,end_ms:1050,text:'你好'}]});
  const controller=new AbortController();
  expect(await transcribeTimelineAudio('ep1','p1',[clip],controller.signal)).toEqual([{clipId:'v1',startMs:100,endMs:1000,text:'你好'}]);
  const request=vi.mocked(apiJson).mock.calls[0][1]!;
  expect(request.signal).toBe(controller.signal);
  expect(JSON.parse(request.body as string).clips[0]).toMatchObject({source_offset_ms:200,duration_ms:1000});
});
it.each([{}, {subtitles:[{clip_id:'foreign',start_ms:0,end_ms:100,text:'a'}]}, {subtitles:[{clip_id:'v1',start_ms:-1,end_ms:100,text:'a'}]}, {subtitles:[{clip_id:'v1',start_ms:10,end_ms:5000,text:'a'}]}, {subtitles:[{clip_id:'v1',start_ms:1000,end_ms:1100,text:'a'}]}])('rejects malformed results instead of silently discarding them',async(response)=>{
  vi.mocked(apiJson).mockResolvedValue(response);
  await expect(transcribeTimelineAudio('ep1','p1',[clip])).rejects.toThrow();
});
