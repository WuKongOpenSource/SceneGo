import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubtitleTranscriptionModal } from '../../components/SubtitleTranscriptionModal';
import { getAudioTranscriptionCapability, transcribeTimelineAudio } from '../../services/audioTranscriptionService';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
vi.mock('../../services/audioTranscriptionService', () => ({ getAudioTranscriptionCapability:vi.fn(), transcribeTimelineAudio:vi.fn() }));
const video: EnhanceMediaClip = { id:'v',type:'video',url:'/storage/v.mp4',sourceOffset:2,startTime:5,duration:10 };
const cue = {clipId:'v',startMs:1000,endMs:2000,text:'对白'};
function props() { return {episodeId:'ep1',clips:[video],subtitles:[],defaultSource:'video_original' as const,onClose:vi.fn(),onApply:vi.fn()}; }
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAudioTranscriptionCapability).mockResolvedValue({available:true});
  vi.mocked(transcribeTimelineAudio).mockResolvedValue([cue]);
});
async function recognize() {
  await waitFor(()=>expect(screen.getByRole('button',{name:'开始识别'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'开始识别'}));
  await screen.findByText('对白');
}
describe('AI subtitle preview', () => {
  it('does not write results until confirmation and maps crop-relative clocks', async () => {
    const p=props(); render(<SubtitleTranscriptionModal {...p}/>);
    await recognize();
    expect(p.onApply).not.toHaveBeenCalled();
    expect(transcribeTimelineAudio).toHaveBeenCalledWith('ep1',undefined,[expect.objectContaining({sourceOffsetMs:2000})],expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button',{name:'加入字幕轨道'}));
    expect(p.onApply).toHaveBeenCalledWith([expect.objectContaining({text:'对白',startTime:6,duration:1})],'fill_gaps',expect.any(String));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('follows the selected audio source and shows unavailable service', async () => {
    vi.mocked(getAudioTranscriptionCapability).mockResolvedValue({available:false,reason:'尚未配置'});
    render(<SubtitleTranscriptionModal {...props()} defaultSource="reference_dubbing"/>);
    expect(screen.getByLabelText('识别来源')).toHaveValue('reference_dubbing');
    await screen.findByText('尚未配置');
    expect(screen.getByRole('button',{name:'开始识别'})).toBeDisabled();
  });
  it('rejects applying results after source timeline changes', async () => {
    const p=props(); const view=render(<SubtitleTranscriptionModal {...p}/>);
    await recognize();
    view.rerender(<SubtitleTranscriptionModal {...p} clips={[{...video,sourceOffset:3}]}/>);
    expect(screen.getByRole('button',{name:'加入字幕轨道'})).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('时间线已变化');
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it('cancels without applying partial results', async () => {
    let finish!: (value:typeof cue[])=>void;
    vi.mocked(transcribeTimelineAudio).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const p=props(); render(<SubtitleTranscriptionModal {...p}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'开始识别'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'开始识别'}));
    await waitFor(()=>expect(transcribeTimelineAudio).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button',{name:'取消识别'}));
    expect(vi.mocked(transcribeTimelineAudio).mock.calls[0][3]?.aborted).toBe(true);
    await act(async()=>{finish([cue]);});
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it('requires confirmation before replacing handwritten subtitles', async () => {
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    const p=props(); render(<SubtitleTranscriptionModal {...p} subtitles={[{id:'manual',text:'手写',startTime:0,duration:1}]}/>);
    await recognize();
    fireEvent.change(screen.getByLabelText('加入方式'),{target:{value:'replace'}});
    fireEvent.click(screen.getByRole('button',{name:'加入字幕轨道'}));
    expect(confirm).toHaveBeenCalled();
    expect(p.onApply).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
