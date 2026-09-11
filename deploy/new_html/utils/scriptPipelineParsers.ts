



import type {
    ScriptSegment,
    VideoScriptBlock,
    VideoScriptGroup,
    ExtractedStoryboardPrompt,
} from '../types';
import {
    ensureSegmentPromptLengths,
    STABILITY_CONSTRAINT_REFERENCE,
} from './scriptPromptStandards';

let _segCounter = 0;
function segLocalId(): string {
    _segCounter += 1;
    return `seg_local_${Date.now().toString(36)}_${_segCounter}`;
}


function parseDurationSec(line: string): number | null {
    const m = line.match(/(?:时长|时间)[（(]?秒?[)）]?\s*[:：]\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
}





export function parseScriptSegments(text: string): ScriptSegment[] {
    if (!text || !text.trim()) return [];

    let blocks: string[];
    if (/^\s*---\s*$/m.test(text)) {
        blocks = text.split(/^\s*---\s*$/m);
    } else {
        blocks = text.split(/\n\s*\n/);
    }

    const segments: ScriptSegment[] = [];
    for (const raw of blocks) {
        const lines = raw.split('\n');
        let durationSec: number | null = null;
        const kept: string[] = [];
        for (const line of lines) {
            const d = parseDurationSec(line);
            if (d !== null && /时长/.test(line)) {
                durationSec = d;
                continue;
            }
            kept.push(line);
        }
        const sourceText = kept.join('\n').trim();
        if (!sourceText) continue;
        segments.push({
            id: segLocalId(),
            order: segments.length,
            sourceText,
            estimatedDurationSec: durationSec,
            status: 'done',
        });
    }
    return segments;
}

const SHOT_HEADER_PATTERN = /^\s*(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?\s*[:：]?\s*$/;
const SHOT_HEADER_WITH_CONTENT_PATTERN = /^\s*(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?\s*[:：]/;

export interface HierarchicalShotNumber {
    segmentNo: number | null;
    localShotNo: number;
}


export function parseHierarchicalShotNumber(value: string): HierarchicalShotNumber | null {
    const match = String(value || '').match(/(?:镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?/);
    if (!match) return null;
    const first = Number.parseInt(match[1], 10);
    const second = match[2] ? Number.parseInt(match[2], 10) : null;
    if (!Number.isFinite(first) || first <= 0 || (second !== null && (!Number.isFinite(second) || second <= 0))) {
        return null;
    }
    return second === null
        ? { segmentNo: null, localShotNo: first }
        : { segmentNo: first, localShotNo: second };
}

export function formatHierarchicalShotNumber(segmentNo: number, localShotNo: number): string {
    return `镜头${segmentNo}-${localShotNo}`;
}

export function formatVideoScriptShotNumber(segmentNo: number, localShotNo: number): string {
    return `分镜${segmentNo}-${localShotNo}`;
}

const VIDEO_SCRIPT_PROMPT_SECTION_PATTERN = /^\s*【(?:视觉风格|正向稳定约束)】/;
const VIDEO_SCRIPT_SEGMENT_HEADER_PATTERN = /^\s*分段\s*\d+\s*[:：]?\s*$/;





export function stripVideoScriptGroupPromptSections(value: string): string {
    const kept: string[] = [];
    let insidePromptSection = false;

    for (const line of String(value || '').split(/\r?\n/)) {
        if (VIDEO_SCRIPT_PROMPT_SECTION_PATTERN.test(line)) {
            insidePromptSection = true;
            continue;
        }
        if (
            insidePromptSection
            && (normalizeShotHeader(line) || VIDEO_SCRIPT_SEGMENT_HEADER_PATTERN.test(line))
        ) {
            insidePromptSection = false;
        }
        if (!insidePromptSection) kept.push(line);
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}


export function findVideoScriptShotBlock(content: string, shotNumber: string): string | null {
    const parsed = parseHierarchicalShotNumber(shotNumber);
    if (!parsed) return null;
    const shotToken = parsed.segmentNo === null
        ? `0*${parsed.localShotNo}(?!\\d)(?!\\s*[-－—]\\s*\\d)`
        : `0*${parsed.segmentNo}\\s*[-－—]\\s*0*${parsed.localShotNo}(?!\\d)`;
    const headerPattern = new RegExp(`^[ \\t]*(?:镜头|分镜)\\s*${shotToken}`, 'm');
    const match = headerPattern.exec(content);
    if (!match) return null;

    const bodyStart = match.index + match[0].length;
    const remaining = content.slice(bodyStart);
    const nextHeader = /^[ \t]*(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?/m.exec(remaining);
    const end = nextHeader ? bodyStart + nextHeader.index : content.length;
    return stripVideoScriptGroupPromptSections(content.slice(match.index, end));
}


export function normalizeShotHeader(line: string): string | null {
    const match = line.match(SHOT_HEADER_PATTERN) || line.match(SHOT_HEADER_WITH_CONTENT_PATTERN);
    if (!match) return null;
    return match[2]
        ? formatVideoScriptShotNumber(Number(match[1]), Number(match[2]))
        : `镜头${Number(match[1])}`;
}





export function parseVideoScriptBlocks(text: string): VideoScriptBlock[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const blocks: VideoScriptBlock[] = [];
    let current: { shotNo: string; lines: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        const rawBlock = stripVideoScriptGroupPromptSections(current.lines.join('\n'));
        let durationSec: number | null = null;
        for (const l of rawBlock.split('\n')) {
            const d = parseDurationSec(l);
            if (d !== null && /(?:时长|时间)/.test(l)) { durationSec = d; break; }
        }
        blocks.push({ shotNo: current.shotNo, durationSec, rawBlock });
        current = null;
    };

    for (const line of lines) {
        const shotNo = normalizeShotHeader(line);
        if (shotNo) {
            flush();
            current = { shotNo, lines: [line] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    flush();
    return blocks;
}

function extractBracketSection(text: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPattern = new RegExp(`^\\s*【${escaped}】\\s*(.*)$`, 'i');
    const collected: string[] = [];
    let collecting = false;

    for (const line of String(text || '').split(/\r?\n/)) {
        const targetMatch = line.match(targetPattern);
        if (targetMatch) {
            if (collecting) break;
            collecting = true;
            collected.push(targetMatch[1]);
            continue;
        }
        if (!collecting) continue;
        if (
            VIDEO_SCRIPT_PROMPT_SECTION_PATTERN.test(line)
            || normalizeShotHeader(line)
            || VIDEO_SCRIPT_SEGMENT_HEADER_PATTERN.test(line)
        ) {
            break;
        }
        collected.push(line);
    }

    return collected.join('\n').trim();
}

function shotRange(blocks: VideoScriptBlock[], groupNo: number): string {
    if (blocks.length === 0) return formatVideoScriptShotNumber(groupNo, 1);
    const first = formatVideoScriptShotNumber(groupNo, 1);
    const last = formatVideoScriptShotNumber(groupNo, blocks.length);
    return first === last ? first : `${first}至${last}`;
}





export function parseVideoScriptGroups(text: string): VideoScriptGroup[] {
    if (!text || !text.trim()) return [];

    const explicit = /^\s*分段\s*(\d+)\s*[:：]?\s*$/gm;
    const headers = [...text.matchAll(explicit)];
    const rawGroups: Array<{ groupNo: number; rawGroup: string }> = [];

    if (headers.length > 0) {
        headers.forEach((header, index) => {
            const start = (header.index || 0) + header[0].length;
            const end = index + 1 < headers.length ? (headers[index + 1].index || text.length) : text.length;
            rawGroups.push({
                groupNo: Number(header[1]) || index + 1,
                rawGroup: text.slice(start, end).trim(),
            });
        });
    } else {
        rawGroups.push({ groupNo: 1, rawGroup: text.trim() });
    }

    return rawGroups.flatMap(({ groupNo, rawGroup }) => {
        const blocks = parseVideoScriptBlocks(rawGroup);
        if (blocks.length === 0) return [];
        const visualStyle = extractBracketSection(rawGroup, '视觉风格');
        const stabilityConstraint = extractBracketSection(rawGroup, '正向稳定约束');
        const promptParts = [
            shotRange(blocks, groupNo),
            visualStyle ? `【视觉风格】${visualStyle}` : '',
            stabilityConstraint ? `【正向稳定约束】${stabilityConstraint}` : '',
        ].filter(Boolean);
        return [{
            groupNo,
            blocks,
            visualStyle,
            stabilityConstraint,
            sharedVideoPrompt: `${promptParts.join('，')}。`,
            rawGroup,
        }];
    });
}

function splitVideoScriptOutputGroups(output: string): string[] {
    const headers = [...output.matchAll(/^\s*分段\s*\d+\s*[:：]?\s*$/gm)];
    if (headers.length === 0) return [output.trim()].filter(Boolean);
    return headers.map((header, index) => {
        const start = (header.index || 0) + header[0].length;
        const end = index + 1 < headers.length ? (headers[index + 1].index || output.length) : output.length;
        return output.slice(start, end).trim();
    }).filter(Boolean);
}

function renumberVideoScriptGroup(rawGroup: string, segmentNo: number): string {
    let localShotNo = 0;
    const body = rawGroup.replace(
        /^(\s*)(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?(\s*[:：]?\s*.*)$/gm,
        (_full, indent: string, suffix: string) => {
            localShotNo += 1;
            return `${indent}${formatVideoScriptShotNumber(segmentNo, localShotNo)}${suffix}`;
        },
    );
    return `分段${segmentNo}\n${body.trim()}`;
}






export function combineVideoScriptOutputs(outputs: string[]): string {
    let groupNo = 0;
    const combined: string[] = [];
    for (const output of outputs.map(value => value.trim()).filter(Boolean)) {
        for (const rawGroup of splitVideoScriptOutputGroups(output)) {
            groupNo += 1;
            combined.push(renumberVideoScriptGroup(rawGroup, groupNo));
        }
    }
    return combined.join('\n\n');
}

const SHOT_SIZE_LABEL_PATTERN = /^\s*景别\s*[：:]/;
const SHOT_SECTION_BOUNDARY_PATTERN = /^\s*(?:分段\s*\d+\s*[：:]?|【(?:视觉风格|正向稳定约束)】)/;
const SHOT_SIZE_TOKENS = [
    '局部大特写',
    '大特写',
    '局部特写',
    '大全景',
    '大远景',
    '中近景',
    '中远景',
    '半身景',
    '全景',
    '远景',
    '中景',
    '近景',
    '特写',
] as const;

function inferShotSize(lines: string[]): string {
    const prioritizedLines = [
        ...lines.filter(line => /^\s*画面描述\s*[：:]/.test(line)),
        ...lines.filter(line => /^\s*(?:镜头运动|运镜方式)\s*[：:]/.test(line)),
    ];
    for (const line of prioritizedLines) {
        const matched = SHOT_SIZE_TOKENS.find(token => line.includes(token));
        if (matched) return matched;
    }
    return '中景';
}






export function ensureExplicitVideoScriptShotSizes(content: string): string {
    const lines = String(content || '').split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        if (!normalizeShotHeader(lines[index])) continue;

        let blockEnd = index + 1;
        while (
            blockEnd < lines.length
            && !normalizeShotHeader(lines[blockEnd])
            && !SHOT_SECTION_BOUNDARY_PATTERN.test(lines[blockEnd])
        ) {
            blockEnd += 1;
        }

        const blockLines = lines.slice(index + 1, blockEnd);
        const shotSize = inferShotSize(blockLines);
        const existingOffset = blockLines.findIndex(line => SHOT_SIZE_LABEL_PATTERN.test(line));

        if (existingOffset >= 0) {
            const existingIndex = index + 1 + existingOffset;
            const existingValue = lines[existingIndex].replace(SHOT_SIZE_LABEL_PATTERN, '').trim();
            if (!existingValue || existingValue === '无') {
                const indent = lines[existingIndex].match(/^\s*/)?.[0] || '';
                lines[existingIndex] = `${indent}景别：${shotSize}`;
            }
            continue;
        }

        const durationOffset = blockLines.findIndex(line => /^\s*(?:时长(?:[（(]秒[)）])?|时间)\s*[：:]/.test(line));
        const insertAt = durationOffset >= 0
            ? index + durationOffset + 2
            : index + 1;
        lines.splice(insertAt, 0, `景别：${shotSize}`);
    }

    return lines.join('\n');
}





export function ensureVideoScriptPromptLengths(content: string): string {
    const normalizedContent = ensureExplicitVideoScriptShotSizes(content);
    const groups = parseVideoScriptGroups(normalizedContent);
    if (groups.length === 0) return normalizedContent.trim();

    return groups.map((group) => {
        const shotBody = stripVideoScriptGroupPromptSections(group.rawGroup);
        const lightAndColor = group.rawGroup.match(/^\s*光影色调\s*[：:]\s*([^\n]+)/m)?.[1]?.trim() || '';
        const derivedVisualStyle = lightAndColor
            ? `${lightAndColor}，电影级写实质感，画面氛围贴合当前剧情`
            : '电影级写实质感，统一色彩与光影层次，画面氛围贴合当前剧情';
        const prompts = ensureSegmentPromptLengths(
            group.visualStyle || derivedVisualStyle,
            group.stabilityConstraint || STABILITY_CONSTRAINT_REFERENCE,
        );
        return [
            `分段${group.groupNo}`,
            shotBody,
            prompts.visualStyle ? `【视觉风格】${prompts.visualStyle}` : '',
            prompts.stabilityConstraint ? `【正向稳定约束】${prompts.stabilityConstraint}` : '',
        ].filter(Boolean).join('\n\n');
    }).join('\n\n');
}





export function normalizeGeneratedVideoScript(content: string): string {
    const cleaned = String(content || '')
        .replace(/^[ \t]*---CUT---[ \t]*$/gmi, '')
        .replace(/^[ \t]*<<<\s*CONTINUE_FROM\b[^>\r\n]*>>>[ \t]*$/gmi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return ensureVideoScriptPromptLengths(cleaned);
}








export function stripDialogueMarkers(s: string): string {
    if (!s) return '';

    const MARKER = /[（(]\s*(?:台词|OS|OV|O\.S\.|V\.O\.|画外音|旁白)(?:\s*[/／、]\s*(?:台词|OS|OV|画外音|旁白))*\s*[）)]/g;
    return s
        .replace(MARKER, '')

        .replace(/[ \t]+([:：])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

const QUOTE_PAIRS: Array<[string, string]> = [
    ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'],
    ['"', '"'], ["'", "'"], ['【', '】'], ['《', '》'],
];


function stripWrappingQuotes(s: string): string {
    let t = (s || '').trim();
    let changed = true;
    while (changed && t.length >= 2) {
        changed = false;
        for (const [l, r] of QUOTE_PAIRS) {
            if (t.startsWith(l) && t.endsWith(r) && t.length > l.length + r.length - 1) {
                t = t.slice(l.length, t.length - r.length).trim();
                changed = true;
                break;
            }
        }
    }
    return t;
}










export function extractSpokenDialogue(
    raw: string,
    charNames: string[] = [],
): { speaker: string; text: string } {
    const original = (raw || '').trim();
    let speaker = '';
    let text = original;

    for (const name of [...charNames, '旁白']) {
        if (name && original.startsWith(name)) {
            speaker = name;
            text = original.slice(name.length).replace(/^[：:，,\s]+/, '');
            break;
        }
    }

    if (!speaker) {
        const m = text.match(/^([^：:「」『』“”‘’"'【】《》\s]{1,10})[：:]\s*/);
        if (m) { speaker = m[1]; text = text.slice(m[0].length); }
    }

    text = stripWrappingQuotes(text);
    // Preserve the original line if normalization would erase all spoken text.
    if (!text) { speaker = ''; text = original; }
    return { speaker, text };
}

const STORYBOARD_LABELS: Array<{ key: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw' | 'propsRaw'; label: RegExp }> = [
    { key: 'shotNoRaw', label: /^镜头号\s*[:：]\s*(.*)$/ },
    { key: 'shotSize', label: /^景别\s*[:：]\s*(.*)$/ },
    { key: 'sceneDescription', label: /^画面描述\s*[:：]\s*(.*)$/ },
    { key: 'charactersRaw', label: /^人物\s*[:：]\s*(.*)$/ },
    { key: 'scene', label: /^场景\s*[:：]\s*(.*)$/ },
    { key: 'propsRaw', label: /^道具\s*[:：]\s*(.*)$/ },
    { key: 'imagePrompt', label: /^分镜生成提示词\s*[:：]\s*(.*)$/ },
    { key: 'cameraAngle', label: /^拍摄角度\s*[:：]\s*(.*)$/ },
    { key: 'cameraMove', label: /^运镜方式\s*[:：]\s*(.*)$/ },
    { key: 'dialogue', label: /^台词\s*[:：]\s*(.*)$/ },
];

/** Parses label-led fields and their multiline continuations from one shot block. */
function parseOneStoryboardBlock(text: string): ExtractedStoryboardPrompt {
    const result: ExtractedStoryboardPrompt = {
        shotNo: '', shotSize: '', sceneDescription: '', characters: [], scene: '', props: [],
        imagePrompt: '', cameraAngle: '', cameraMove: '', dialogue: '', durationSec: null,
    };
    if (!text) return result;

    const lines = text.split('\n');
    let currentKey: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | 'charactersRaw' | 'propsRaw' | null = null;
    const buf: Record<string, string[]> = {};

    const matchLabel = (line: string) => {
        for (const { key, label } of STORYBOARD_LABELS) {
            const m = line.match(label);
            if (m) return { key, rest: m[1] ?? '' };
        }
        return null;
    };

    for (const line of lines) {
        const dur = line.match(/^时长\s*[:：]\s*(\d+)/);
        if (dur) { result.durationSec = parseInt(dur[1], 10); currentKey = null; continue; }

        const hit = matchLabel(line);
        if (hit) {
            currentKey = hit.key;
            buf[currentKey] = [hit.rest];
        } else if (currentKey) {
            buf[currentKey].push(line);
        }
    }

    const take = (k: string) => (buf[k] ? buf[k].join('\n').trim() : '');
    const shotNo = parseHierarchicalShotNumber(`镜头${take('shotNoRaw')}`);
    result.shotNo = shotNo
        ? shotNo.segmentNo
            ? formatHierarchicalShotNumber(shotNo.segmentNo, shotNo.localShotNo)
            : `镜头${shotNo.localShotNo}`
        : '';
    result.shotSize = take('shotSize');
    result.sceneDescription = take('sceneDescription');
    const charactersRaw = take('charactersRaw');
    result.characters = charactersRaw.trim() === '无'
        ? []
        : charactersRaw.split(/[、，,/／]/).map(c => c.trim()).filter(Boolean);
    const scene = take('scene');
    result.scene = scene.trim() === '无' ? '' : scene;
    const propsRaw = take('propsRaw');
    result.props = propsRaw.trim() === '无'
        ? []
        : propsRaw.split(/[、，,/／]/).map(p => p.trim()).filter(Boolean);
    result.cameraAngle = take('cameraAngle');
    result.cameraMove = take('cameraMove');
    result.imagePrompt = take('imagePrompt') || [
        result.shotSize,
        result.cameraAngle,
        result.sceneDescription,
    ].filter(Boolean).join('，');
    const dialogue = take('dialogue');
    result.dialogue = dialogue.trim() === '无' ? '' : stripDialogueMarkers(dialogue);
    return result;
}

/** Splits a Stage 3 response into independently parsed shot blocks. */
export function parseStoryboardPromptExtractions(text: string): ExtractedStoryboardPrompt[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const rawBlocks: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        if (/^\s*镜头号/.test(line)) {
            if (current) rawBlocks.push(current.join('\n'));
            current = [line];
        } else if (current) {
            current.push(line);
        }
    }
    if (current) rawBlocks.push(current.join('\n'));

    if (rawBlocks.length === 0) {
        const single = parseOneStoryboardBlock(text);
        return (single.imagePrompt || single.sceneDescription || single.shotSize) ? [single] : [];
    }
    return rawBlocks
        .map(parseOneStoryboardBlock)
        .filter(b => b.imagePrompt || b.sceneDescription || b.shotSize);
}
