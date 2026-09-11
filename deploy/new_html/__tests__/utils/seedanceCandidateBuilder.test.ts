import { describe, it, expect } from 'vitest';
import {
    buildCandidates,
    buildVideoMaterialLibrary,
    type CandidateBuildContext,
} from '../../utils/seedanceCandidateBuilder';
import { baseParams } from './_fixtures/seedance';   // tiny shared helper, see step 3.13

const emptyCtx = (): CandidateBuildContext => ({
    currentParams: baseParams(),
    materialLibrary: { characters: [], scenes: [], props: [], audio: [] } as any,
    storyboardItems: [],
    historyVideos: [],
    userFiles: [],
});

describe('buildCandidates', () => {
    it('returns just the ark_asset_id placeholder when context is empty', () => {
        // Plan inconsistency: original assertion was toEqual([]) but the spec §6.1,
        // test #9 ("always emits exactly one ark_asset_id placeholder"), and the
        // plan step 3.14 impl all agree the ark entry is always present. The two
        // assertions cannot both hold; the empty-output reading is the contradiction.
        // Aligning with the dominant contract (impl + spec + test #9).
        const cands = buildCandidates(emptyCtx());
        expect(cands).toHaveLength(1);
        expect(cands[0].group).toBe('ark_asset_id');
    });
    it('emits current_card group for already-added media', () => {
        const ctx = emptyCtx();
        ctx.currentParams.media_inputs = [
            { kind: 'image', url: '/a.png' },
            { kind: 'audio', url: '/a.mp3' },
        ];
        const cands = buildCandidates(ctx);
        const cur = cands.filter(c => c.group === 'current_card');
        expect(cur).toHaveLength(2);
        expect(cur[0].kind).toBe('image');
        expect(cur[1].kind).toBe('audio');
    });
    it('emits assets group from materialLibrary characters/scenes/props', () => {
        const ctx = emptyCtx();
        ctx.materialLibrary = {
            characters: [{ id: 'c1', name: '主角', currentVersion: { url: '/c.png' } }],
            scenes:     [{ id: 's1', name: '咖啡馆', currentVersion: { url: '/s.png' } }],
            props:      [{ id: 'p1', name: '吉他', currentVersion: { url: '/p.png' } }],
            audio:      [],
        } as any;
        const cands = buildCandidates(ctx);
        const assets = cands.filter(c => c.group === 'assets');
        expect(assets.map(c => c.label)).toEqual(['主角', '咖啡馆', '吉他']);
        expect(assets.every(c => c.kind === 'image')).toBe(true);
    });
    it('emits storyboard_data text candidates from sceneHeading + dialogue', () => {
        const ctx = emptyCtx();
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, scene_heading: 'INT. 卧室', dialogue: '"我在这里"', generated_image_url: null },
        ] as any;
        const cands = buildCandidates(ctx);
        const text = cands.filter(c => c.group === 'storyboard_data');
        expect(text.length).toBeGreaterThanOrEqual(2);
        expect(text.some(c => c.label.includes('SB-1'))).toBe(true);
        expect(text.every(c => c.kind === 'text')).toBe(true);
    });
    it('emits image candidates for storyboards with generated_image_url', () => {
        const ctx = emptyCtx();
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, generated_image_url: '/storage/sb1.png' },
        ] as any;
        const cands = buildCandidates(ctx);
        const sbImgs = cands.filter(c => c.group === 'storyboard_data' && c.kind === 'image');
        expect(sbImgs).toHaveLength(1);
        expect(sbImgs[0].url).toBe('/storage/sb1.png');
        expect(sbImgs[0].storyboardItemId).toBe('sb1');
    });
    it('emits audio group from materialLibrary.audio + storyboard audio urls', () => {
        const ctx = emptyCtx();
        ctx.materialLibrary = {
            characters: [], scenes: [], props: [],
            audio: [{ id: 'a1', name: '主题曲', currentVersion: { url: '/m.mp3', durationMs: 12000 } }],
        } as any;
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, dialogue_audio_url: '/sb1_d.mp3' },
        ] as any;
        const cands = buildCandidates(ctx);
        const audio = cands.filter(c => c.group === 'audio');
        expect(audio.length).toBeGreaterThanOrEqual(2);
    });
    it('emits video_segments from historyVideos', () => {
        const ctx = emptyCtx();
        ctx.historyVideos = [{ id: 'v1', url: '/v.mp4', label: '镜头 1', durationMs: 6000 }] as any;
        const cands = buildCandidates(ctx);
        expect(cands.filter(c => c.group === 'video_segments')).toHaveLength(1);
    });
    it('emits user_files from entity_files (image/video/audio kinds)', () => {
        const ctx = emptyCtx();
        ctx.userFiles = [
            { id: 'f1', file_url: '/u/x.png', file_name: 'x.png', mime_type: 'image/png' },
            { id: 'f2', file_url: '/u/y.mp4', file_name: 'y.mp4', mime_type: 'video/mp4' },
        ] as any;
        const cands = buildCandidates(ctx);
        const uf = cands.filter(c => c.group === 'user_files');
        expect(uf).toHaveLength(2);
        expect(uf.map(c => c.kind).sort()).toEqual(['image', 'video']);
    });
    it('always emits exactly one ark_asset_id placeholder candidate at the end', () => {
        const cands = buildCandidates(emptyCtx());
        const last = cands[cands.length - 1];
        // Even on empty context, the ark prompt entry exists
        const arkOnly = buildCandidates(emptyCtx()).filter(c => c.group === 'ark_asset_id');
        expect(arkOnly).toHaveLength(1);
        expect(arkOnly[0].label).toMatch(/asset:\/\//);
    });

    it('filters storyboard_data candidates by currentStoryboardItemId', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'item-2',
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1, scene_heading: 'A', dialogue: 'a' },
                { item_id: 'item-2', sort_order: 2, scene_heading: 'B', dialogue: 'b', generated_image_url: '/b.png' },
                { item_id: 'item-3', sort_order: 3, scene_heading: 'C' },
            ],
        };
        const out = buildCandidates(ctx);
        const sb = out.filter(c => c.group === 'storyboard_data');
        expect(sb.every((c: any) => c.storyboardItemId === 'item-2')).toBe(true);
        // heading + dialogue + image = 3 entries for item-2
        expect(sb).toHaveLength(3);
    });

    it('keeps other storyboard generated images available as library resources', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'item-2',
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1, scene_heading: 'A', generated_image_url: '/a.png' },
                { item_id: 'item-2', sort_order: 2, scene_heading: 'B', generated_image_url: '/b.png' },
                { item_id: 'item-3', sort_order: 3, scene_heading: 'C', generated_image_url: '/c.png' },
            ],
        };
        const out = buildCandidates(ctx);
        const scoped = out.filter(c => c.group === 'storyboard_data');
        const reusable = out.filter(c => c.group === 'storyboard_library');

        expect(scoped.every(candidate => candidate.storyboardItemId === 'item-2')).toBe(true);
        expect(reusable.map(candidate => candidate.url)).toEqual(['/a.png', '/c.png']);
    });

    it('filters audio candidates by currentStoryboardItemId (no public audio bleed)', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'item-2',
            materialLibrary: {
                characters: [], scenes: [], props: [],
                audio: [{ id: 'lib-a', name: 'BGM', currentVersion: { url: '/bgm.mp3' } }],
            },
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1, dialogue_audio_url: '/a-dlg.mp3' },
                { item_id: 'item-2', sort_order: 2, narration_audio_url: '/b-nar.mp3', mixed_audio_url: '/b-mix.mp3' },
            ],
        };
        const out = buildCandidates(ctx);
        const audio = out.filter(c => c.group === 'audio');
        expect(audio.map(c => c.id).sort()).toEqual(
            ['audio_sb_item-2_mixed', 'audio_sb_item-2_narration'].sort()
        );
    });

    it('collects image_prompt + video_prompt + lines as text candidates for the current scene', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'item-1',
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1,
                  image_prompt: 'a wide shot of a city',
                  video_prompt: 'camera pans left, vehicles move',
                  lines: 'NARRATOR: the city sleeps...' },
            ],
        };
        const out = buildCandidates(ctx);
        const labels = out.filter(c => c.group === 'storyboard_data' && c.kind === 'text').map(c => c.label);
        expect(labels.some(l => /图片提示词/.test(l))).toBe(true);
        expect(labels.some(l => /视频提示词/.test(l))).toBe(true);
        expect(labels.some(l => /旁白/.test(l))).toBe(true);
    });

    // Normalized and legacy key styles must yield identical candidates.
    it('reads storyboard fields from camelCase keys (post-normalize shape)', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'sb1',
            storyboardItems: [
                {
                    itemId: 'sb1',
                    sortOrder: 1,
                    sceneHeading: 'INT. 卧室',
                    dialogue: '"我在这里"',
                    imagePrompt: 'a wide shot',
                    videoPrompt: 'pan left',
                    generatedImageUrl: '/sb1.png',
                    dialogueAudioUrl: '/sb1-dlg.mp3',
                    narrationAudioUrl: '/sb1-nar.mp3',
                    sfxAudioUrl: '/sb1-sfx.mp3',
                    mixedAudioUrl: '/sb1-mix.mp3',
                },
            ],
        };
        const out = buildCandidates(ctx);
        const sb = out.filter(c => c.group === 'storyboard_data');
        const audio = out.filter(c => c.group === 'audio');
        // 4 text + 1 image = 5 storyboard_data candidates
        expect(sb).toHaveLength(5);
        // dialogue + narration + sfx + mixed = 4 audio candidates
        expect(audio).toHaveLength(4);
        // SB-N label uses sortOrder
        expect(sb.every(c => c.label.includes('SB-1'))).toBe(true);
    });

    it('filters storyboard candidates by currentStoryboardItemId on camelCase items', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'item-b',
            storyboardItems: [
                { itemId: 'item-a', sortOrder: 1, dialogueAudioUrl: '/a.mp3', sceneHeading: 'A' },
                { itemId: 'item-b', sortOrder: 2, dialogueAudioUrl: '/b.mp3', sceneHeading: 'B' },
            ],
        };
        const out = buildCandidates(ctx);
        const audio = out.filter(c => c.group === 'audio');
        const sb = out.filter(c => c.group === 'storyboard_data');
        expect(audio).toHaveLength(1);
        expect(audio[0].url).toBe('/b.mp3');
        expect(sb.every((c: any) => c.storyboardItemId === 'item-b')).toBe(true);
    });




    it('emits audio candidates from character_voices.sampleAudioUrl', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'sb1',
            characterVoices: [
                { voiceId: 'cv1', characterName: '小王', voiceName: '清亮男声', sampleAudioUrl: '/voices/cv1.mp3' },
                { voiceId: 'cv2', characterName: '旁白', voiceName: '沉稳女声', sampleAudioUrl: '/voices/cv2.mp3' },
                { voiceId: 'cv3', characterName: '没有样本', voiceName: 'x', sampleAudioUrl: null },
            ],
        };
        const out = buildCandidates(ctx);
        const cvAudio = out.filter(c => c.group === 'audio' && c.id.startsWith('cv_'));
        expect(cvAudio).toHaveLength(2);
        expect(cvAudio.map(c => c.label)).toEqual(
            expect.arrayContaining([expect.stringMatching(/小王/), expect.stringMatching(/旁白/)])
        );
    });

    it('emits audio candidates from audio_tracks (BGM / SFX 项目级)', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'sb1',
            audioTracks: [
                { trackId: 't1', name: '紧张 BGM', trackType: 'bgm', audioUrl: '/tracks/t1.mp3', durationMs: 90000 },
                { trackId: 't2', name: '关门音效', trackType: 'sfx', audioUrl: '/tracks/t2.wav' },
                { trackId: 't3', name: '空轨', trackType: 'bgm', audioUrl: null },
            ],
        };
        const out = buildCandidates(ctx);
        const trAudio = out.filter(c => c.group === 'audio' && c.id.startsWith('track_'));
        expect(trAudio).toHaveLength(2);
        expect(trAudio.map(c => c.url)).toEqual(['/tracks/t1.mp3', '/tracks/t2.wav']);
    });

    it('keeps character_voices + audio_tracks visible even when scoped to a storyboard item', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentStoryboardItemId: 'sb1',
            storyboardItems: [{ itemId: 'sb1', sortOrder: 1, dialogueAudioUrl: '/sb1-d.mp3' }],
            characterVoices: [{ voiceId: 'cv1', characterName: '主角', sampleAudioUrl: '/cv1.mp3' }],
            audioTracks: [{ trackId: 't1', name: 'BGM', audioUrl: '/t1.mp3' }],
        };
        const out = buildCandidates(ctx);
        const audio = out.filter(c => c.group === 'audio');
        // sb1 dialogue + cv1 + t1 = 3
        expect(audio).toHaveLength(3);
    });

    it('emits project media-library image, video, and audio resources', () => {
        const ctx: any = {
            ...emptyCtx(),
            mediaLibraryItems: [
                { library_item_id: 'lib-image', item_type: 'image', title: '设计图', file_url: '/library/design.png' },
                { library_item_id: 'lib-video', item_type: 'video', title: '分镜视频', file_url: '/library/shot.mp4' },
                {
                    library_item_id: 'lib-audio',
                    item_type: 'audio',
                    title: '配音',
                    file_url: '/library/voice.mp3',
                    duration_seconds: 2.5,
                },
            ],
        };
        const media = buildCandidates(ctx).filter(candidate => candidate.group === 'media_library');

        expect(media.map(candidate => candidate.kind)).toEqual(['image', 'video', 'audio']);
        expect(media.find(candidate => candidate.kind === 'audio')?.durationMs).toBe(2500);
    });

    it('deduplicates the same resource URL across current card and libraries', () => {
        const ctx: any = {
            ...emptyCtx(),
            currentParams: {
                ...baseParams(),
                media_inputs: [{ kind: 'image', url: '/same.png' }],
            },
            mediaLibraryItems: [
                { library_item_id: 'lib-image', item_type: 'image', file_url: '/same.png' },
            ],
        };
        const matching = buildCandidates(ctx).filter(candidate => candidate.url === '/same.png');

        expect(matching).toHaveLength(1);
        expect(matching[0].group).toBe('current_card');
    });
});

describe('buildVideoMaterialLibrary', () => {
    it('exposes every generated asset image instead of only the first one', () => {
        const library = buildVideoMaterialLibrary([
            {
                assetId: 'character-1',
                assetType: 'character',
                name: '主角',
                thumbnailUrl: '/thumb.png',
                referenceImages: ['/ref-1.png', '/ref-2.png', '/thumb.png'],
                entityFiles: [
                    { fileId: 'generated-1', fileType: 'image', fileUrl: '/generated.png', fileRole: 'generated_image' },
                    { fileId: 'video-1', fileType: 'video', fileUrl: '/generated.mp4' },
                ],
            },
        ]);

        expect(library.characters.map((item: any) => item.currentVersion.url)).toEqual([
            '/thumb.png',
            '/ref-1.png',
            '/ref-2.png',
            '/generated.png',
        ]);
        expect(library.scenes).toEqual([]);
        expect(library.props).toEqual([]);
    });

    it('supports legacy snake_case asset type fields', () => {
        const library = buildVideoMaterialLibrary([
            {
                asset_id: 'scene-legacy',
                asset_type: 'scene',
                name: 'Legacy scene',
                thumbnail_url: '/legacy-scene.png',
            },
        ]);

        expect(library.scenes).toHaveLength(1);
        expect(library.scenes[0].currentVersion.url).toBe('/legacy-scene.png');
    });
});
