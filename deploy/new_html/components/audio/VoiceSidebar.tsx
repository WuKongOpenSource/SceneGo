import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  User, ChevronRight, Settings, Play, Save, Trash2, Loader,
  Volume2, Copy, Wand2, Upload, X,
} from 'lucide-react';
import {
  createCharacterVoice, updateCharacterVoice, deleteCharacterVoice,
  minimaxVoiceDesign, minimaxVoiceClone, minimaxFileUpload,
  minimaxTTSSync,
} from '@runtime/audioGenerationService';



import type { AssetItem, CharacterVoice, VoiceDesignSetting } from '../../types';
import {
  getVoicePreview, setVoicePreview,
  makeSystemKey, makeDesignKey, makeCloneKey,
} from '../../utils/voicePreviewCache';
import { safeBrowserResourceUrl } from '../../services/httpClient';

function resolveUrl(path: string) {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

function hexToAudioBlobUrl(hex: string, mime = 'audio/mpeg') {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}







function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function buildVoiceDesignPrompt(setting: VoiceDesignSetting): string {
  const gender = setting.voice_type === 'male' ? '男性' : '女性';
  const emotionMap: Record<string, string> = {
    happy: '高兴活泼', sad: '悲伤低沉', angry: '愤怒有力', fearful: '紧张害怕',
    disgusted: '厌恶冷淡', surprised: '惊讶明亮', neutral: '中性自然',
    excited: '兴奋有活力',
  };
  const pace = setting.speed > 1.05 ? '语速偏快' : setting.speed < 0.95 ? '语速偏慢' : '语速适中';
  const pitch = setting.pitch > 2 ? '音调偏高' : setting.pitch < -2 ? '音调偏低' : '音调自然';
  return `${gender}配音员，${emotionMap[setting.emotion] || '中性自然'}，${pace}，${pitch}，适合影视对白与旁白。`;
}

function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return resolveUrl(ef.fileUrl);
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}


const SYSTEM_VOICES: Array<{ id: string; label: string; group: '男声' | '女声' | '主持' | '童声' }> = [
  { id: 'male-qn-qingse',       label: '青年男·清涩',  group: '男声' },
  { id: 'male-qn-jingying',     label: '青年男·精英',  group: '男声' },
  { id: 'male-qn-badao',        label: '青年男·霸道',  group: '男声' },
  { id: 'male-qn-daxuesheng',   label: '青年男·大学生', group: '男声' },
  { id: 'female-shaonv',        label: '少女',         group: '女声' },
  { id: 'female-yujie',         label: '御姐',         group: '女声' },
  { id: 'female-chengshu',      label: '成熟女声',      group: '女声' },
  { id: 'female-tianmei',       label: '甜美女声',      group: '女声' },
  { id: 'presenter_male',       label: '男主持',        group: '主持' },
  { id: 'presenter_female',     label: '女主持',        group: '主持' },
  { id: 'audiobook_male_1',     label: '男声有声书 1',  group: '主持' },
  { id: 'audiobook_male_2',     label: '男声有声书 2',  group: '主持' },
  { id: 'audiobook_female_1',   label: '女声有声书 1',  group: '主持' },
  { id: 'audiobook_female_2',   label: '女声有声书 2',  group: '主持' },
  { id: 'clever_boy',           label: '聪明男童',      group: '童声' },
  { id: 'cute_boy',             label: '可爱男童',      group: '童声' },
  { id: 'lovely_girl',          label: '可爱女童',      group: '童声' },
];

const SYSTEM_VOICE_DEFAULT = 'presenter_male';


const LEGACY_VOICE_ALIAS: Record<string, string> = {
  narrator: 'presenter_male',
  male_young: 'male-qn-qingse',
  female_young: 'female-shaonv',
  elder: 'audiobook_male_2',
  child: 'cute_boy',
};

type VoiceSource = 'system' | 'clone' | 'design';

export interface VoiceSidebarProps {
  assets: AssetItem[];
  characterVoices: CharacterVoice[];
  projectId: string;
  reload: () => Promise<void>;
}

export const VoiceSidebar: React.FC<VoiceSidebarProps> = ({
  assets, characterVoices, projectId, reload,
}) => {
  const characterAssets = useMemo(
    () => assets.filter(a => ((a as any).assetType || (a as any).asset_type) === 'character'),
    [assets],
  );

  const roles = useMemo(() => {
    const list: { name: string; asset?: AssetItem; voice?: CharacterVoice }[] = [];
    const voiceMap = new Map(characterVoices.map(v => [v.characterName, v]));
    for (const a of characterAssets) {
      const name = (a as any).name || '未命名';
      list.push({ name, asset: a, voice: voiceMap.get(name) });
    }
    if (!list.some(r => r.name === '旁白')) {
      list.push({ name: '旁白', voice: voiceMap.get('旁白') });
    }
    return list;
  }, [characterAssets, characterVoices]);

  const [drawerRole, setDrawerRole] = useState<string | null>(null);

  return (
    <div className="workflow-stage-sidebar w-52 shrink-0 flex flex-col border-r border-n40 bg-n0">
      <h3 className="workflow-stage-toolbar flex items-center px-3 text-xs font-bold text-n100 uppercase tracking-wider border-b border-n40">
        角色声音
      </h3>
      <div className="workflow-stage-scroll flex-1 overflow-auto space-y-1 px-2 py-2">
        {roles.map(role => {
          const thumb = getAssetThumb(role.asset);
          return (
            <button
              key={role.name}
              onClick={() => setDrawerRole(role.name)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-n20 group"
            >
              {thumb ? (
                <img src={thumb} alt="" className="w-8 h-8 rounded-lg object-cover bg-n0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }}
                />
              ) : null}
              <div className="w-8 h-8 rounded-lg bg-n0 flex items-center justify-center" style={thumb ? { display: 'none' } : undefined}>
                <User size={14} className="text-n100" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{role.name}</div>
                {role.voice ? (
                  <div className="text-[10px] text-success truncate">
                    {role.voice.voiceName || '已配音'}
                  </div>
                ) : (
                  <div className="text-[10px] text-n100">未配音</div>
                )}
              </div>
              <ChevronRight size={12} className="text-n100 group-hover:text-n300 shrink-0" />
            </button>
          );
        })}
      </div>

      {drawerRole && (
        <VoiceDrawer
          roleName={drawerRole}
          role={roles.find(r => r.name === drawerRole)}
          projectId={projectId}
          onClose={() => setDrawerRole(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
};


export interface VoiceDrawerProps {
  roleName: string;
  role?: { name: string; asset?: AssetItem; voice?: CharacterVoice };
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;





  open?: boolean;
}

type CloneDraft = {
  fileId: string;
  filename: string;
  size: number;
  lastModified: number;
  voiceId: string;
  audioUrl: string;
};

const CLONE_PREVIEW_TEXT = '\u4f60\u597d\uff0c\u8fd9\u662f\u4e00\u6bb5\u6d4b\u8bd5\u8bed\u97f3\u3002';

export const VoiceDrawer: React.FC<VoiceDrawerProps> = ({
  roleName, role, projectId, onClose, onSaved, open = true,
}) => {



  const existingParams = (role?.voice?.voiceParams || {}) as Record<string, any>;
  const inferSource = (): VoiceSource => {
    const src = existingParams.source as VoiceSource | undefined;
    if (src === 'system' || src === 'clone' || src === 'design') return src;
    const id = role?.voice?.voiceModelId || '';
    if (id.startsWith('ttv-voice-')) return 'design';
    if (id && !SYSTEM_VOICES.some(v => v.id === id)) return 'clone';
    return 'system';
  };

  const inferSystemVoiceId = (): string => {
    const id = role?.voice?.voiceModelId || '';
    if (SYSTEM_VOICES.some(v => v.id === id)) return id;
    if (id in LEGACY_VOICE_ALIAS) return LEGACY_VOICE_ALIAS[id];
    return SYSTEM_VOICE_DEFAULT;
  };

  const [voiceSource, setVoiceSource] = useState<VoiceSource>(inferSource);
  const [systemVoiceId, setSystemVoiceId] = useState(inferSystemVoiceId);


  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [savedCloneMeta, setSavedCloneMeta] = useState<{ file_id?: string; filename?: string }>(() => ({
    file_id: existingParams.file_id, filename: existingParams.original_filename,
  }));
  const [cloneDraft, setCloneDraft] = useState<CloneDraft | null>(null);

  const [designSetting, setDesignSetting] = useState<VoiceDesignSetting>(
    (existingParams.setting as VoiceDesignSetting) || {
      voice_type: 'female', emotion: 'neutral', speed: 1.0, pitch: 0,
    }
  );
  const [designText, setDesignText] = useState(
    (existingParams.preview_text as string) || '你好，这是一段测试语音。'
  );

  const [saving, setSaving] = useState(false);





  const designKey = useCallback(
    () => makeDesignKey(stableStringify(designSetting), designText),
    [designSetting, designText]
  );
  const systemKey = useCallback(() => makeSystemKey(systemVoiceId), [systemVoiceId]);

  const currentInputKey = voiceSource === 'design' ? designKey()
    : voiceSource === 'system' ? systemKey()
    : makeCloneKey(savedCloneMeta.file_id || '');



  const sampleAudioFromDb = role?.voice?.sampleAudioUrl ? resolveUrl(role.voice.sampleAudioUrl) : '';
  const initialCached = getVoicePreview(currentInputKey);
  const initialPreviewUrl = initialCached?.audioUrl || sampleAudioFromDb;
  if (sampleAudioFromDb && !initialCached && role?.voice?.voiceModelId) {
    setVoicePreview(currentInputKey, {
      voiceId: role.voice.voiceModelId,
      audioUrl: sampleAudioFromDb,
    });
  }

  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRef = useRef<HTMLAudioElement>(null);

  // Abort an in-flight preview when its dialog closes.
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open && previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
    return () => {
      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
        previewAbortRef.current = null;
      }
    };
  }, [open]);


  const [previewIsPersisted, setPreviewIsPersisted] = useState(!!initialPreviewUrl);


  useEffect(() => {
    const entry = getVoicePreview(currentInputKey);
    if (entry?.audioUrl) {
      setPreviewUrl(entry.audioUrl);
      setPreviewIsPersisted(true);
    } else {
      setPreviewUrl('');
      setPreviewIsPersisted(false);
    }
  }, [currentInputKey]);

  const handleCloneFileChange = useCallback((file: File | null) => {
    setCloneFile(file);
    setCloneDraft(null);
    if (file) {
      setPreviewUrl('');
      setPreviewIsPersisted(false);
    }
  }, []);

  const generateClonePreview = useCallback(async (): Promise<CloneDraft | null> => {
    if (!cloneFile) {
      alert('请选择要克隆的音频文件');
      return null;
    }

    const canReuseDraft = cloneDraft
      && cloneDraft.filename === cloneFile.name
      && cloneDraft.size === cloneFile.size
      && cloneDraft.lastModified === cloneFile.lastModified;
    if (canReuseDraft) {
      if (cloneDraft.audioUrl) {
        setPreviewUrl(cloneDraft.audioUrl);
        setPreviewIsPersisted(true);
      }
      return cloneDraft;
    }

    const uploadRes = await minimaxFileUpload(cloneFile, 'voice_clone');
    const fileId = uploadRes.file_id;
    if (!fileId) {
      throw new Error('MiniMax 上传成功但未返回 file_id');
    }

    const cloneRes = await minimaxVoiceClone(fileId, undefined, CLONE_PREVIEW_TEXT, roleName);
    const voiceId = cloneRes.voice_id || '';
    if (!voiceId) {
      throw new Error('MiniMax 声音克隆成功但未返回 voice_id');
    }

    const cloneAudio = cloneRes.audio_url ? resolveUrl(cloneRes.audio_url)
      : cloneRes.demo_audio ? resolveUrl(cloneRes.demo_audio)
      : '';
    if (!cloneAudio) {
      throw new Error('MiniMax 声音克隆成功但未返回试听音频');
    }

    const draft: CloneDraft = {
      fileId,
      filename: cloneFile.name,
      size: cloneFile.size,
      lastModified: cloneFile.lastModified,
      voiceId,
      audioUrl: cloneAudio,
    };

    setCloneDraft(draft);
    setVoicePreview(makeCloneKey(fileId), { voiceId, audioUrl: cloneAudio });
    setPreviewUrl(cloneAudio);
    setPreviewIsPersisted(true);
    return draft;
  }, [cloneFile, cloneDraft, roleName]);



  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);

    if (previewAbortRef.current) previewAbortRef.current.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    try {
      if (voiceSource === 'design') {
        const key = designKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }
        const res = await minimaxVoiceDesign(buildVoiceDesignPrompt(designSetting), designText);
        const audioUrl = res.audio_url ? resolveUrl(res.audio_url)
          : res.trial_audio ? hexToAudioBlobUrl(res.trial_audio)
          : '';
        if (res.voice_id && audioUrl) {
          setVoicePreview(key, { voiceId: res.voice_id, audioUrl });
        }
        if (audioUrl) {
          setPreviewUrl(audioUrl);

          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'system') {
        const key = systemKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }





        const existingVoiceId = role?.voice?.voiceId;
        const result = await minimaxTTSSync({
          text: '你好，这是一段测试语音。',
          voice_id: systemVoiceId,
          speed: 1.0, pitch: 0,
          bind_to_character_voice_id: existingVoiceId,
        }, controller.signal);
        if (result.audio_url) {
          const url = resolveUrl(result.audio_url);
          setVoicePreview(key, { voiceId: systemVoiceId, audioUrl: url });
          setPreviewUrl(url);
          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'clone') {
        if (!cloneFile && previewUrl) {
          setPreviewIsPersisted(true);
          return;
        }
        const draft = await generateClonePreview();
        if (draft?.audioUrl) {
          setPreviewUrl(draft.audioUrl);
          setPreviewIsPersisted(true);
        }
      }
    } catch (e: any) {

      if (e?.name === 'AbortError') return;
      console.error('试听失败:', e);
      const msg = e?.message || '试听失败';


      if (/未配置|MINIMAX_API_KEY|503/.test(msg)) {
        alert(`试听失败：${msg}\n\n请联系管理员在后台 → API 配置 中添加 MINIMAX_API_KEY（与 Hailuo 视频共用）。`);
      } else if (/过长|413/.test(msg)) {
        alert(`试听失败：试听文本过长（>1000 字符）。试听通常只用短文本，请检查代码或联系开发。`);
      } else {
        alert(`试听失败：${msg}`);
      }
    } finally {
      setPreviewLoading(false);
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
    }
  }, [voiceSource, designText, designSetting, systemVoiceId, designKey, systemKey, previewUrl, role, cloneFile, generateClonePreview]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const existing = role?.voice;
      let provider = 'minimax';
      let modelId = systemVoiceId;
      let voiceName = SYSTEM_VOICES.find(v => v.id === systemVoiceId)?.label || systemVoiceId;
      let params: Record<string, any> = { source: 'system', voice_id: systemVoiceId };
      let sampleUrl: string | null = previewUrl || null;

      if (voiceSource === 'clone') {
        if (cloneFile) {
          const draft = await generateClonePreview();
          if (!draft) return;
          const fileId = draft.fileId;
          modelId = draft.voiceId;
          voiceName = `${roleName}-克隆`;
          const cloneAudio = draft.audioUrl;
          sampleUrl = cloneAudio || sampleUrl;
          params = {
            source: 'clone',
            file_id: fileId,
            original_filename: cloneFile.name,
            cloned_voice_id: modelId,
          };
          if (cloneAudio) {
            setPreviewUrl(cloneAudio);
            setPreviewIsPersisted(true);
          }
        } else if (existing?.voiceProvider === 'minimax' && existing.voiceModelId) {

          modelId = existing.voiceModelId;
          voiceName = existing.voiceName || `${roleName}-克隆`;
          params = { ...existingParams, source: 'clone' };
        } else {
          alert('请选择要克隆的音频文件');
          return;
        }
      } else if (voiceSource === 'design') {
        const key = designKey();
        const cached = getVoicePreview(key);
        if (cached?.voiceId) {

          modelId = cached.voiceId;
          sampleUrl = cached.audioUrl || sampleUrl;
        } else {

          const designRes = await minimaxVoiceDesign(buildVoiceDesignPrompt(designSetting), designText);
          modelId = designRes.voice_id || '';
          const audioUrl = designRes.audio_url ? resolveUrl(designRes.audio_url)
            : designRes.trial_audio ? hexToAudioBlobUrl(designRes.trial_audio)
            : '';
          sampleUrl = audioUrl || sampleUrl;
          if (modelId && audioUrl) {
            setVoicePreview(key, { voiceId: modelId, audioUrl });
            setPreviewUrl(audioUrl);
            setPreviewIsPersisted(true);
          }
        }
        voiceName = `${roleName}-设计`;
        params = {
          source: 'design',
          setting: designSetting,
          preview_text: designText,
          designed_voice_id: modelId,
        };
      } else {

        const cached = getVoicePreview(systemKey());
        if (cached?.audioUrl) {
          sampleUrl = cached.audioUrl;
        }
        params = { source: 'system', voice_id: systemVoiceId };
      }

      if (!modelId) {
        alert('未生成有效音色 ID，请重试或换一种音源');
        return;
      }

      if (existing) {
        await updateCharacterVoice(existing.voiceId, {
          voice_provider: provider,
          voice_model_id: modelId,
          voice_name: voiceName,
          voice_params: params,
          sample_audio_url: sampleUrl,
        });
      } else {
        const matchingAsset = role?.asset;
        await createCharacterVoice({
          project_id: projectId,
          character_name: roleName,
          asset_id: matchingAsset ? ((matchingAsset as any).assetId || (matchingAsset as any).asset_id) : undefined,
          voice_provider: provider,
          voice_model_id: modelId,
          voice_name: voiceName,
          voice_params: params,
          sample_audio_url: sampleUrl || undefined,
        });
      }
      if (voiceSource === 'clone' && cloneFile) {
        setSavedCloneMeta({ file_id: (params as any).file_id, filename: cloneFile.name });
        setCloneFile(null);
      }
      await onSaved();
      onClose();
    } catch (e: any) {
      console.error('保存音色失败:', e);
      alert(`保存音色失败：${e?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [
    roleName, voiceSource, systemVoiceId, cloneFile, designSetting, designText,
    previewUrl, role, projectId, onSaved, onClose, designKey, systemKey, existingParams, generateClonePreview,
  ]);

  const handleDeleteVoice = useCallback(async (voiceId: string) => {
    try {
      await deleteCharacterVoice(voiceId);
      await onSaved();
      onClose();
    } catch (e) {
      console.error('删除失败:', e);
    }
  }, [onSaved, onClose]);

  return (
    <div className="app-drawer-backdrop fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`${roleName}声音配置`} className="app-drawer-surface relative ml-auto w-96 bg-n0 border-l border-n40 h-full overflow-auto p-6 shadow-bottom">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Settings size={16} className="text-primary" />
            {roleName} — 声音配置
            {role?.voice && (
              <span className="text-xs text-success bg-success/10 px-2 py-0.5 rounded ml-2">
                已配: {role.voice.voiceName}
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-n100 hover:text-n700">
            <X size={18} />
          </button>
        </div>

        {/* Source selector */}
        <div className="flex gap-2 mb-5">
          {([
            { id: 'system' as VoiceSource, label: '系统预设', icon: Volume2 },
            { id: 'clone' as VoiceSource, label: '声音克隆', icon: Copy },
            { id: 'design' as VoiceSource, label: '声音设计', icon: Wand2 },
          ]).map(src => (
            <button
              key={src.id}
              onClick={() => setVoiceSource(src.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                voiceSource === src.id
                  ? 'bg-primary text-white'
                  : 'bg-n0 text-n300 hover:text-n700 border border-n40'
              }`}
            >
              <src.icon size={12} /> {src.label}
            </button>
          ))}
        </div>


        {voiceSource === 'system' && (
          <div className="space-y-3 mb-5">
            <label className="block text-xs text-n100">
              选择系统声音 <span className="text-n100">(MiniMax 海螺 T2A)</span>
            </label>
            {(['男声', '女声', '主持', '童声'] as const).map(group => {
              const items = SYSTEM_VOICES.filter(v => v.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <div className="text-[10px] text-n100 mb-1.5">{group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSystemVoiceId(v.id)}
                        className={`px-2.5 py-1.5 rounded-md text-xs transition-all ${
                          systemVoiceId === v.id
                            ? 'bg-primary text-white'
                            : 'bg-n0 text-n300 border border-n40 hover:border-n40'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Clone */}
        {voiceSource === 'clone' && (
          <div className="space-y-3 mb-5">
            {savedCloneMeta.filename && !cloneFile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-xs text-success">
                <Volume2 size={12} />
                <span className="flex-1 truncate">已配置克隆音色：{savedCloneMeta.filename}</span>
                <span className="text-success/70 text-[10px]">复用已克隆</span>
              </div>
            )}
            <label className="block text-xs text-n100">
              {savedCloneMeta.filename ? '重新上传参考音频（可选）' : '上传参考音频（10-300 秒清晰人声）'}
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-n0 border border-n40 text-sm text-n700 cursor-pointer hover:bg-n20 transition-all">
                <Upload size={14} />
                {cloneFile ? cloneFile.name : '选择文件'}
                <input
                  type="file"
                  accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/x-m4a"
                  className="hidden"
                  onChange={e => handleCloneFileChange(e.target.files?.[0] || null)}
                />
              </label>
              {cloneFile && (
                <span className="text-xs text-n100">{(cloneFile.size / 1024).toFixed(0)} KB</span>
              )}
            </div>
          </div>
        )}

        {/* Design */}
        {voiceSource === 'design' && (
          <div className="space-y-4 mb-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-n100 mb-1">声音类型</label>
                <select
                  value={designSetting.voice_type}
                  onChange={e => setDesignSetting(p => ({ ...p, voice_type: e.target.value as any }))}
                  className="w-full bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n700"
                >
                  <option value="male">男声</option>
                  <option value="female">女声</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-n100 mb-1">情绪</label>
                <select
                  value={designSetting.emotion}
                  onChange={e => setDesignSetting(p => ({ ...p, emotion: e.target.value as any }))}
                  className="w-full bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n700"
                >
                  <option value="neutral">中性</option>
                  <option value="happy">快乐</option>
                  <option value="sad">悲伤</option>
                  <option value="angry">愤怒</option>
                  <option value="excited">兴奋</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-n100 mb-1">语速 ({designSetting.speed.toFixed(1)}x)</label>
                <input
                  type="range" min="0.5" max="2.0" step="0.1"
                  value={designSetting.speed}
                  onChange={e => setDesignSetting(p => ({ ...p, speed: parseFloat(e.target.value) }))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-n100 mb-1">音调 ({designSetting.pitch})</label>
                <input
                  type="range" min="-12" max="12" step="1"
                  value={designSetting.pitch}
                  onChange={e => setDesignSetting(p => ({ ...p, pitch: parseInt(e.target.value) }))}
                  className="w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-n100 mb-1">试听文本</label>
              <textarea
                value={designText}
                onChange={e => setDesignText(e.target.value)}
                rows={2}
                className="w-full bg-n0 border border-n40 rounded-lg px-3 py-2 text-sm text-n700 resize-none"
              />
            </div>
          </div>
        )}


        <div className="pt-4 border-t border-n40 space-y-3">

          {previewUrl ? (
            <div className="rounded-lg border p-3 transition-colors bg-primary-light border-primary/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] text-primary font-medium">
                  <Volume2 size={11} />
                  试听音频
                </div>
                {previewIsPersisted ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30">
                    已永久缓存
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-light text-primary border border-primary/30">
                    新生成
                  </span>
                )}
              </div>
              <audio
                ref={previewRef}
                src={previewUrl}
                controls
                className="w-full h-9"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-n40 p-3 text-center text-[11px] text-n100">
              {voiceSource === 'clone' && !cloneFile && !savedCloneMeta.filename
                ? '请先上传参考音频后再试听'
                : '点击"试听"生成预览音频'}
            </div>
          )}


          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={previewLoading || saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-n0 border border-n40 text-xs text-n700 hover:bg-n20 transition-all disabled:opacity-50"
            >
              {previewLoading ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
              {voiceSource === 'clone' ? (cloneFile && !previewUrl ? '生成试听' : '试听') : previewUrl && previewIsPersisted ? '重新生成' : '试听'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || previewLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              {saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
              保存配置
            </button>
            {role?.voice && (
              <button
                onClick={() => handleDeleteVoice(role.voice!.voiceId)}
                className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-danger hover:bg-r50 text-xs transition-all"
                title="删除当前角色配音"
              >
                <Trash2 size={13} />
                <span>删除</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
