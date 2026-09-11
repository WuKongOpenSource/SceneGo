import { describe, it, expect } from 'vitest';
import {
    parseScriptSegments,
    parseVideoScriptBlocks,
    parseVideoScriptGroups,
    combineVideoScriptOutputs,
    ensureExplicitVideoScriptShotSizes,
    ensureVideoScriptPromptLengths,
    findVideoScriptShotBlock,
    normalizeGeneratedVideoScript,
    parseStoryboardPromptExtractions,
    stripDialogueMarkers,
} from '../../utils/scriptPipelineParsers';
import {
    countPromptCharacters,
    MIN_STABILITY_CONSTRAINT_CHARACTERS,
    MIN_VISUAL_STYLE_CHARACTERS,
    STABILITY_CONSTRAINT_REFERENCE,
    VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';

describe('findVideoScriptShotBlock', () => {
    it('keeps the production references complete without a genre-specific fallback', () => {
        expect(countPromptCharacters(VISUAL_STYLE_REFERENCE)).toBeGreaterThanOrEqual(MIN_VISUAL_STYLE_CHARACTERS);
        expect(VISUAL_STYLE_REFERENCE).not.toMatch(/古风|战争|赛博朋克|日漫|校园/);
        expect(countPromptCharacters(STABILITY_CONSTRAINT_REFERENCE)).toBe(203);
    });

    it('matches the full hierarchical number instead of the first segment digit', () => {
        const content = [
            '分段2',
            '镜头2-1',
            '画面描述：第一个镜头。',
            '镜头2-2',
            '画面描述：第二个镜头。',
            '镜头3-1',
            '画面描述：下一分段。',
        ].join('\n');

        expect(findVideoScriptShotBlock(content, '镜头2-2')).toBe([
            '镜头2-2',
            '画面描述：第二个镜头。',
        ].join('\n'));
        expect(findVideoScriptShotBlock(content, '镜头2-1')).not.toContain('第二个镜头');
    });

    it('keeps legacy flat shot numbers from matching hierarchical headers', () => {
        const content = '镜头1-1\n画面描述：新格式。\n镜头1\n画面描述：旧格式。';
        expect(findVideoScriptShotBlock(content, '镜头1')).toContain('旧格式');
        expect(findVideoScriptShotBlock(content, '镜头1')).not.toContain('新格式');
    });
});

describe('parseScriptSegments', () => {
    it('splits on --- and reads 时长：N秒', () => {
        const text = [
            '1-1 日 外 浅浅家门口',
            '浅浅：哟，陆帅哥来啦。',
            '时长：5秒',
            '---',
            '1-2 日 内 浅浅家',
            '陆一航：脱衣服吧，我赶时间。',
            '时长：11秒',
        ].join('\n');
        const segs = parseScriptSegments(text);
        expect(segs).toHaveLength(2);
        expect(segs[0].order).toBe(0);
        expect(segs[0].estimatedDurationSec).toBe(5);
        expect(segs[0].sourceText).toContain('浅浅家门口');
        expect(segs[0].sourceText).not.toContain('时长');
        expect(segs[1].estimatedDurationSec).toBe(11);
    });

    it('sets estimatedDurationSec=null when 时长 missing', () => {
        const segs = parseScriptSegments('某段原文没有时长\n---\n另一段\n时长：8秒');
        expect(segs[0].estimatedDurationSec).toBeNull();
        expect(segs[1].estimatedDurationSec).toBe(8);
    });

    it('falls back to blank-line blocks when no --- present', () => {
        const text = '段一第一行\n时长：6秒\n\n段二第一行\n时长：7秒';
        const segs = parseScriptSegments(text);
        expect(segs).toHaveLength(2);
        expect(segs[0].estimatedDurationSec).toBe(6);
    });

    it('does not crash on empty input', () => {
        expect(parseScriptSegments('')).toEqual([]);
    });

    it('concatenated sourceText covers input body (minus 时长 lines)', () => {
        const text = 'A行1\nA行2\n时长：5秒\n---\nB行1\n时长：9秒';
        const segs = parseScriptSegments(text);
        const joined = segs.map(s => s.sourceText).join('\n');
        expect(joined).toContain('A行1');
        expect(joined).toContain('A行2');
        expect(joined).toContain('B行1');
    });
});

describe('parseVideoScriptBlocks', () => {
    const sample = [
        '镜头1',
        '时长（秒）：4',
        '画面描述：三架战机编队。',
        '镜头运动：远景，缓慢横移跟拍，俯视视角。',
        '镜头2：',
        '时长（秒）：3',
        '画面描述：卫星端坐驾驶舱。',
        '镜头 3',
        '时长（秒）：2',
        '画面描述：拇指按下通讯键。',
        '【视觉风格】冷峻战争写实，胶片质感。',
        '【正向稳定约束】无背景音乐，保持无字幕，竖屏主体居中。',
    ].join('\n');

    it('splits multiple 镜头N (with/without colon/space)', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks).toHaveLength(3);
        expect(blocks[0].shotNo).toBe('镜头1');
        expect(blocks[1].shotNo).toBe('镜头2');
        expect(blocks[2].shotNo).toBe('镜头3');
    });

    it('keeps the full block text in rawBlock', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks[0].rawBlock).toContain('画面描述：三架战机编队');
        expect(blocks[0].rawBlock).toContain('镜头运动：远景');
        expect(blocks[2].rawBlock).not.toContain('【视觉风格】');
        expect(blocks[2].rawBlock).not.toContain('【正向稳定约束】');
    });

    it('parses 时长（秒）：N', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks[0].durationSec).toBe(4);
        expect(blocks[2].durationSec).toBe(2);
    });

    it('also accepts legacy 时间：N秒 duration labels', () => {
        const blocks = parseVideoScriptBlocks('分段1\n镜头1-1\n时间：6秒\n画面描述：主角抬头。');
        expect(blocks[0].durationSec).toBe(6);
    });

    it('accepts 分镜 headings while keeping stage-two canonical shot numbers', () => {
        const blocks = parseVideoScriptBlocks('分段1\n分镜1-1\n时间：6秒\n画面描述：主角抬头。');
        expect(blocks[0].shotNo).toBe('分镜1-1');
        expect(blocks[0].rawBlock).toContain('分镜1-1');
        expect(findVideoScriptShotBlock('分段1\n分镜1-1\n画面描述：主角抬头。', '镜头1-1'))
            .toContain('主角抬头');
    });

    it('returns [] for empty', () => {
        expect(parseVideoScriptBlocks('')).toEqual([]);
    });
});

describe('parseVideoScriptGroups', () => {
    const grouped = [
        '分段01',
        '镜头1',
        '时长（秒）：4',
        '画面描述：角色进入办公室。',
        '镜头2',
        '时长（秒）：3',
        '画面描述：角色坐下。',
        '【视觉风格】都市写实，柔和日光，电影质感。',
        '【正向稳定约束】角色形象固定，无字幕、无水印，动作连续自然。',
        '分段02',
        '镜头1',
        '时长（秒）：5',
        '画面描述：角色开始演讲。',
        '【视觉风格】冷静商务风格，蓝灰主调。',
        '【正向稳定约束】人物服装固定，镜头稳定，无跳帧。',
    ].join('\n');

    it('keeps multiple static shots in one video group', () => {
        const groups = parseVideoScriptGroups(grouped);
        expect(groups).toHaveLength(2);
        expect(groups[0].blocks).toHaveLength(2);
        expect(groups[1].blocks).toHaveLength(1);
    });

    it('builds one shared video prompt from the group range and long constraints', () => {
        const [group] = parseVideoScriptGroups(grouped);
        expect(group.sharedVideoPrompt).toContain('分镜1-1至分镜1-2');
        expect(group.sharedVideoPrompt).toContain('【视觉风格】都市写实');
        expect(group.sharedVideoPrompt).toContain('【正向稳定约束】角色形象固定');
    });

    it('renumbers separately generated outputs before saving a full version', () => {
        const combined = combineVideoScriptOutputs([
            '分段01\n镜头1\n时长（秒）：3',
            '分段01\n镜头1\n时长（秒）：4',
        ]);
        expect(combined).toContain('分段1\n分镜1-1');
        expect(combined).toContain('分段2\n分镜2-1');
        expect(combined.match(/分段1/g)).toHaveLength(1);
    });

    it('parses hierarchical shot numbers without collapsing the separator', () => {
        const blocks = parseVideoScriptBlocks('分段12\n镜头12-3\n时长（秒）：5');
        expect(blocks[0].shotNo).toBe('分镜12-3');
    });

    it('adds an explicit shot size inferred from the visual description', () => {
        const normalized = ensureExplicitVideoScriptShotSizes([
            '分段1',
            '分镜1-1',
            '时长（秒）：5',
            '画面描述：特写，女主角抬眼看向镜头。',
            '镜头运动：缓慢推近，平视角度。',
        ].join('\n'));

        expect(normalized).toContain('时长（秒）：5\n景别：特写\n画面描述');
    });

    it('preserves an existing shot size and defaults to a medium shot when none can be inferred', () => {
        const existing = ensureExplicitVideoScriptShotSizes([
            '分段1',
            '分镜1-1',
            '时间：3秒',
            '景别：远景',
            '画面描述：人物穿过荒原。',
        ].join('\n'));
        const fallback = ensureExplicitVideoScriptShotSizes([
            '分段1',
            '分镜1-1',
            '时间：3秒',
            '画面描述：人物推门进入办公室。',
        ].join('\n'));

        expect(existing.match(/景别：远景/g)).toHaveLength(1);
        expect(fallback).toContain('时间：3秒\n景别：中景\n画面描述');
    });

    it('keeps later shots out of a misplaced segment constraint section', () => {
        const normalized = ensureVideoScriptPromptLengths([
            '分段1',
            '镜头1-1',
            '时间：5秒',
            '景别：中景',
            '画面描述：角色站在门口。',
            '【视觉风格】复古中式与科幻元素融合。',
            '【正向稳定约束】角色造型与空间关系保持稳定。',
            '保持无字幕、无水印、无Logo。',
            '镜头1-2',
            '时间：5秒',
            '景别：近景',
            '画面描述：角色抬手指向菜单板。',
            '镜头运动：固定镜头，平视角度。',
        ].join('\n'));
        const [group] = parseVideoScriptGroups(normalized);

        expect(group.blocks).toHaveLength(2);
        expect(normalized).toContain('镜头1-2\n时间：5秒\n景别：近景');
        expect(normalized.indexOf('镜头1-2')).toBeLessThan(normalized.indexOf('【视觉风格】'));
        expect(group.stabilityConstraint).toContain('无背景音乐');
        expect(group.stabilityConstraint).not.toContain('镜头1-2');
        expect(group.stabilityConstraint).not.toContain('画面描述：角色抬手');
    });

    it('silently pads short segment prompts while preserving shot content', () => {
        const normalized = ensureVideoScriptPromptLengths([
            '分段1',
            '镜头1-1',
            '时长（秒）：15',
            '画面描述：主角推门进入办公室。',
            '【视觉风格】都市写实。',
            '【正向稳定约束】人物与场景稳定。',
        ].join('\n'));
        const [group] = parseVideoScriptGroups(normalized);

        expect(group.blocks[0].rawBlock).toContain('主角推门进入办公室');
        expect(group.blocks[0].rawBlock).toContain('景别：中景');
        expect(countPromptCharacters(group.visualStyle)).toBeGreaterThanOrEqual(MIN_VISUAL_STYLE_CHARACTERS);
        expect(countPromptCharacters(group.stabilityConstraint))
            .toBeGreaterThanOrEqual(MIN_STABILITY_CONSTRAINT_CHARACTERS);
    });

    it('removes internal continuation markers and preserves complete production constraints', () => {
        const normalized = normalizeGeneratedVideoScript([
            '分段1',
            '镜头1-1',
            '时间：8秒',
            '光影色调：现代都市冷峻硬光，冲突张力强烈。',
            '画面描述：两人在会议室激烈对峙。',
            '---CUT---',
            '【视觉风格】现代都市写实，冲突爆发的冷峻张力。',
            '【正向稳定约束】角色身份与服装稳定，五官和肢体自然，无字幕、无水印、无Logo。',
            '<<<CONTINUE_FROM 镜头1-2>>>',
        ].join('\n'));
        const [group] = parseVideoScriptGroups(normalized);

        expect(normalized).not.toContain('---CUT---');
        expect(normalized).not.toContain('CONTINUE_FROM');
        expect(normalized).toContain('现代都市写实');
        expect(normalized).toContain('同一场景内，所有镜头的摄影机机位');
        expect(countPromptCharacters(group.visualStyle)).toBeGreaterThanOrEqual(MIN_VISUAL_STYLE_CHARACTERS);
        expect(countPromptCharacters(group.stabilityConstraint))
            .toBeGreaterThanOrEqual(MIN_STABILITY_CONSTRAINT_CHARACTERS);
    });
});

describe('parseStoryboardPromptExtractions', () => {
    const shot = [
        '镜头号：2',
        '景别：近景',
        '画面描述：卫星端坐驾驶舱内，眼神沉稳。',
        '人物：卫星',
        '场景：一号机驾驶舱',
        '分镜生成提示词：近景，平视角度，卫星端坐驾驶舱，冷蓝调，胶片质感。',
        '拍摄角度：平视视角',
        '运镜方式：缓慢推近',
        '台词：卫星（台词）：“一号机报告，”',
        '时长：2秒',
    ].join('\n');

    it('parses a single 镜头号 block into a 1-element array', () => {
        const list = parseStoryboardPromptExtractions(shot);
        expect(list).toHaveLength(1);
        const r = list[0];
        expect(r.shotNo).toBe('镜头2');
        expect(r.shotSize).toBe('近景');
        expect(r.sceneDescription).toContain('眼神沉稳');
        expect(r.characters).toEqual(['卫星']);
        expect(r.scene).toBe('一号机驾驶舱');
        expect(r.imagePrompt).toContain('冷蓝调');
        expect(r.cameraAngle).toBe('平视视角');
        expect(r.cameraMove).toBe('缓慢推近');
        expect(r.dialogue).toContain('一号机报告');
        expect(r.durationSec).toBe(2);
    });

    it('splits 人物 by 、，/ into an array', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n景别：中景\n画面描述：三人对峙。\n人物：陆一航、浅浅，赵峰\n场景：浅浅家\n分镜生成提示词：P\n台词：无\n时长：5秒'
        );
        expect(list[0].characters).toEqual(['陆一航', '浅浅', '赵峰']);
        expect(list[0].scene).toBe('浅浅家');
    });

    it('preserves a hierarchical shot number returned by stage 3', () => {
        const [result] = parseStoryboardPromptExtractions(shot.replace('镜头号：2', '镜头号：镜头2-3'));
        expect(result.shotNo).toBe('镜头2-3');
    });

    it('splits 道具 by 、，/ into an array', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n景别：中景\n画面描述：小悟亮出扇子和长剑。\n人物：小悟\n场景：茶馆\n道具：扇子、长剑\n分镜生成提示词：P\n台词：无\n时长：5秒'
        );
        expect(list[0].props).toEqual(['扇子', '长剑']);
    });

    it('converts 人物：无 / 场景：无 to [] and empty string', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n景别：远景\n画面描述：空镜。\n人物：无\n场景：无\n道具：无\n分镜生成提示词：P\n台词：无\n时长：3秒'
        );
        expect(list[0].characters).toEqual([]);
        expect(list[0].scene).toBe('');
        expect(list[0].props).toEqual([]);
    });

    it('splits one video shot into multiple finer 镜头号 blocks', () => {
        const multi = [
            '镜头号：1', '景别：远景', '画面描述：A画面。',
            '分镜生成提示词：PA', '拍摄角度：俯视视角', '运镜方式：横移', '台词：无', '时长：3秒',
            '镜头号：2', '景别：近景', '画面描述：B画面。',
            '分镜生成提示词：PB', '拍摄角度：平视视角', '运镜方式：推近', '台词：卫星（台词）：“走”', '时长：2秒',
        ].join('\n');
        const list = parseStoryboardPromptExtractions(multi);
        expect(list).toHaveLength(2);
        expect(list[0].shotNo).toBe('镜头1');
        expect(list[0].imagePrompt).toBe('PA');
        expect(list[1].shotNo).toBe('镜头2');
        expect(list[1].dialogue).toContain('走');
    });

    it('converts 台词：无 to empty string', () => {
        const list = parseStoryboardPromptExtractions('镜头号：1\n景别：远景\n分镜生成提示词：P\n台词：无\n时长：3秒');
        expect(list).toHaveLength(1);
        expect(list[0].dialogue).toBe('');
    });

    it('handles multi-line 画面描述', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n画面描述：第一行。\n第二行继续。\n景别：远景\n分镜生成提示词：P'
        );
        expect(list[0].sceneDescription).toContain('第一行');
        expect(list[0].sceneDescription).toContain('第二行继续');
    });

    it('derives the image prompt from the final shot fields when the duplicate label is absent', () => {
        const list = parseStoryboardPromptExtractions([
            '镜头号：1',
            '景别：中景',
            '画面描述：小悟站在办公室窗边，柔和日光照亮侧脸。',
            '拍摄角度：平视',
            '运镜方式：固定',
            '台词：无',
            '时长：3秒',
        ].join('\n'));
        expect(list).toHaveLength(1);
        expect(list[0].imagePrompt).toContain('中景');
        expect(list[0].imagePrompt).toContain('平视');
        expect(list[0].imagePrompt).toContain('柔和日光');
    });

    it('returns [] for empty', () => {
        expect(parseStoryboardPromptExtractions('')).toEqual([]);
    });

    it('strips （台词）/（OS）/（OV） markers from extracted dialogue', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n景别：近景\n分镜生成提示词：P\n台词：浅浅（台词）：“哟，陆帅哥来啦。”\n时长：3秒'
        );
        expect(list[0].dialogue).toBe('浅浅：“哟，陆帅哥来啦。”');
        expect(list[0].dialogue).not.toContain('（台词）');
    });
});

describe('stripDialogueMarkers', () => {
    it('removes （台词） and tightens spacing', () => {
        expect(stripDialogueMarkers('浅浅（台词）：“快进来。”')).toBe('浅浅：“快进来。”');
    });

    it('removes （OS）/（OV）/（台词/OS/OV） and half-width forms', () => {
        expect(stripDialogueMarkers('陆一航（OS）：真空？')).toBe('陆一航：真空？');
        expect(stripDialogueMarkers('旁白(OV)：夜深了')).toBe('旁白：夜深了');
        expect(stripDialogueMarkers('卫星（台词/OS/OV）：报告')).toBe('卫星：报告');
    });

    it('keeps plain dialogue unchanged', () => {
        expect(stripDialogueMarkers('浅浅：哟')).toBe('浅浅：哟');
        expect(stripDialogueMarkers('')).toBe('');
    });
});
