





import { StoryboardItem } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
  formatHierarchicalShotNumber,
  formatVideoScriptShotNumber,
  parseHierarchicalShotNumber,
} from './scriptPipelineParsers';





export interface ShotBlockFields {
  shotId: string;
  segmentNo?: number;
  '时长（秒）'?: string;
  时长?: string;
  时间?: string;
  景别?: string;
  取景?: string;
  拍摄角度?: string;
  角度?: string;
  摄像机角度?: string;
  运镜方式?: string;
  运动?: string;
  镜头运动?: string;
  机位?: string;
  画面描述?: string;
  分镜生成提示词?: string;
  光影色调?: string;
  画质?: string;
  台词?: string;
  站位与构图?: string;
  动作与神态?: string;
  氛围与特效?: string;
  人声?: string;
  音效?: string;
  转场?: string;
  场景名称?: string;
  人物名称?: string;
  道具名称?: string;
  视频提示词?: string;
  视觉化描述?: string;
}




export interface ParseResult {
  shots: StoryboardItem[];
  displayText: string;
  continueFrom?: string;
  rawBlocks: ShotBlockFields[];
}

export function estimateDialogueDurationSeconds(dialogue: string | undefined): number {
  const raw = String(dialogue || '').trim();
  if (!raw || raw === '无') return 0;

  const quotedSegments = [...raw.matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1]);
  const spokenText = (quotedSegments.length > 0 ? quotedSegments.join('') : raw.replace(/^[^：:\n]{1,24}[：:]\s*/, ''))
    .replace(/\s+/g, '');
  const chineseCharacters = (spokenText.match(/[\u3400-\u9fff]/g) || []).length;
  const englishCharacters = (spokenText.match(/[A-Za-z0-9]/g) || []).length;
  if (chineseCharacters === 0 && englishCharacters === 0) return 0;
  return Math.max(1, Math.ceil(chineseCharacters / 4 + englishCharacters / 8));
}

/** Parses only complete stream blocks and preserves the unfinished tail. */
export function parseStreamingBlocks(buffer: string): {
  completedBlocks: ShotBlockFields[];
  displayText: string;
  remainingBuffer: string;
  continueFrom?: string;
} {
  const completedBlocks: ShotBlockFields[] = [];
  let displayText = '';
  let remainingBuffer = buffer;
  let continueFrom: string | undefined;

  // Continuation markers control the request stream and must not reach display text.
  const continueMatch = buffer.match(/<<<CONTINUE_FROM\s+((?:镜头|分镜)\d+(?:-\d+)?)>>>/);
  if (continueMatch) {
    continueFrom = continueMatch[1];

    remainingBuffer = buffer.replace(/<<<CONTINUE_FROM\s+(?:镜头|分镜)\d+(?:-\d+)?>>>\s*/, '');
  }

  // A block is complete only after the explicit delimiter arrives.
  const parts = remainingBuffer.split(/---CUT---/);
  let activeSegmentNo: number | undefined;

  const parsePart = (part: string): ShotBlockFields | null => {
    const segmentMatch = part.match(/(?:^|\n)\s*(?:分段|段落)\s*0*(\d+)\s*(?:\n|$)/);
    if (segmentMatch) activeSegmentNo = Number.parseInt(segmentMatch[1], 10);
    const block = parseBlockFields(part.trim());
    if (block && activeSegmentNo) block.segmentNo = activeSegmentNo;
    return block;
  };


  for (let i = 0; i < parts.length - 1; i++) {
    const block = parsePart(parts[i]);
    if (block) {
      completedBlocks.push(block);

      displayText += parts[i].trim() + '\n\n';
    }
  }


  const lastPart = parts[parts.length - 1];
  if (buffer.endsWith('---CUT---') || buffer.trim().endsWith('---CUT---')) {

    const block = parsePart(lastPart);
    if (block) {
      completedBlocks.push(block);
      displayText += lastPart.trim() + '\n\n';
    }
    remainingBuffer = '';
  } else {
    remainingBuffer = lastPart;
  }

  return {
    completedBlocks,
    displayText: displayText.trim(),
    remainingBuffer,
    continueFrom
  };
}


export function parseBlockFields(blockText: string): ShotBlockFields | null {
  if (!blockText.trim()) return null;

  const lines = blockText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return null;

  const fields: ShotBlockFields = { shotId: '' };
  let currentField: string | null = null;
  let currentValue: string[] = [];

  // Historical field aliases remain readable but are never emitted by the new format.
  const knownFields = [
    '时长（秒）', '时长', '时间',
    '景别',
    '取景',
    '拍摄角度',
    '角度', '摄像机角度',
    '运镜方式',
    '运动', '镜头运动',
    '机位',
    '画面描述', '分镜生成提示词', '光影色调', '画质', '台词',
    '站位与构图', '动作与神态', '氛围与特效',
    '人声', '音效', '转场', '场景名称', '人物名称', '道具名称', '视频提示词',
    '视觉化描述'
  ];


  const groupHeaders = ['镜头描述', '镜头语言'];

  for (let line of lines) {


    line = line.replace(/^[\s\-\*•·◦→●○]+/, '');


    if (/^(?:分段|段落)\s*0*\d+\s*$/.test(line)) continue;

    // Segment-wide style headers are projected by the caller, not stored as shot fields.
    if (/^【(?:视觉风格|正向稳定约束)】/.test(line)) {
      if (currentField && currentValue.length > 0) {
        (fields as any)[currentField] = currentValue.join('\n');
      }
      currentField = null;
      currentValue = [];
      continue;
    }


    const shotIdMatch = line.match(/^(镜头|分镜)\s*(\d+)(?:\s*[-－—]\s*(\d+))?/);
    if (shotIdMatch) {

      if (currentField && currentValue.length > 0) {
        (fields as any)[currentField] = currentValue.join('\n');
      }

      const isVideoScriptStoryboard = shotIdMatch[1] === '分镜';
      fields.shotId = shotIdMatch[3]
        ? isVideoScriptStoryboard
          ? formatVideoScriptShotNumber(Number(shotIdMatch[2]), Number(shotIdMatch[3]))
          : formatHierarchicalShotNumber(Number(shotIdMatch[2]), Number(shotIdMatch[3]))
        : `${isVideoScriptStoryboard ? '分镜' : '镜头'}${shotIdMatch[2].padStart(2, '0')}`;
      const parsedShotNo = parseHierarchicalShotNumber(fields.shotId);
      if (!fields.segmentNo && parsedShotNo?.segmentNo) fields.segmentNo = parsedShotNo.segmentNo;
      currentField = null;
      currentValue = [];
      continue;
    }


    let isGroupHeader = false;
    for (const header of groupHeaders) {
      if (line === header + '：' || line === header + ':') {

        if (currentField && currentValue.length > 0) {
          (fields as any)[currentField] = currentValue.join('\n');
        }

        currentField = null;
        currentValue = [];
        isGroupHeader = true;
        break;
      }
    }
    if (isGroupHeader) continue;

    // Combined labels are accepted only when every component is a known field.
    const mergedFieldMatch = line.match(/^([^：:]+)[：:](.*)$/);
    if (mergedFieldMatch) {
      const fieldNamesPart = mergedFieldMatch[1].trim();
      const valuePart = mergedFieldMatch[2].trim();
      if (/[\/／、]/.test(fieldNamesPart)) {
        const subFields = fieldNamesPart.split(/[\/／、]/).map(s => s.trim()).filter(Boolean);
        const knownSubFields = subFields.filter(sf => knownFields.includes(sf));

        if (knownSubFields.length === subFields.length && knownSubFields.length >= 2 && valuePart) {

          if (currentField && currentValue.length > 0) {
            (fields as any)[currentField] = currentValue.join('\n');
          }


          (fields as any)[knownSubFields[0]] = valuePart;
          currentField = null;
          currentValue = [];
          continue;
        }
      }
    }


    let foundField = false;
    for (const fieldName of knownFields) {
      if (line.startsWith(fieldName + '：') || line.startsWith(fieldName + ':')) {

        if (currentField && currentValue.length > 0) {
          (fields as any)[currentField] = currentValue.join('\n');
        }

        currentField = fieldName;
        const value = line.substring(fieldName.length + 1).trim();
        currentValue = value ? [value] : [];
        foundField = true;
        break;
      }
    }


    if (!foundField && currentField) {
      currentValue.push(line);
    }
  }


  if (currentField && currentValue.length > 0) {
    (fields as any)[currentField] = currentValue.join('\n');
  }


  if (!fields.shotId) return null;

  return fields;
}

/** Maps canonical fields while retaining read compatibility for historical output. */
export function convertToStoryboardItem(fields: ShotBlockFields): StoryboardItem {

  const cleanFieldValue = (value: string | undefined): string => {
    if (!value) return '';
    return value
      .replace(/^(镜头描述|画面描述|视觉化描述)[：:]\s*/gi, '')
      .trim();
  };


  const 景别 = fields.景别 || fields.取景 || '';
  const 角度 = fields.拍摄角度 || fields.角度 || fields.摄像机角度 || '';
  const 运动 = fields.运镜方式 || fields.运动 || fields.镜头运动 || '';
  const 对白 = fields.人声 || fields.台词 || '';
  const rawDuration = fields['时长（秒）'] || fields.时长 || fields.时间 || '';
  const originalDuration = fields['时长（秒）'] && /^\d+(?:\.\d+)?$/.test(rawDuration.trim())
    ? `${rawDuration.trim()}秒`
    : rawDuration;
  const dialogueDurationFloor = estimateDialogueDurationSeconds(对白);
  const parsedDuration = Number.parseFloat(originalDuration);
  // Spoken dialogue is a hard lower bound for the resulting shot duration.
  const 时长 = dialogueDurationFloor > 0 && (!Number.isFinite(parsedDuration) || parsedDuration < dialogueDurationFloor)
    ? `${dialogueDurationFloor}秒`
    : originalDuration;

  const canonicalImagePromptParts = [
    cleanFieldValue(景别),
    cleanFieldValue(角度),
    cleanFieldValue(fields.画面描述),
    cleanFieldValue(fields.光影色调),
  ].filter(v => v && v.length > 0);
  const legacyImagePromptParts = [
    cleanFieldValue(fields.取景),
    cleanFieldValue(角度),
    cleanFieldValue(fields.机位),
    cleanFieldValue(fields.站位与构图),
    cleanFieldValue(fields.氛围与特效),
  ].filter(v => v && v.length > 0);
  const hasCanonicalFields = Boolean(
    fields.景别
    || fields.画面描述
    || fields.分镜生成提示词
    || fields.拍摄角度
    || fields.运镜方式
    || fields.光影色调
    || fields.画质
    || fields['时长（秒）']
    || fields.台词
  );

  let imagePrompt = cleanFieldValue(fields.分镜生成提示词)
    || (hasCanonicalFields ? canonicalImagePromptParts.join('，') : '')
    || legacyImagePromptParts.join('，');
  if (!imagePrompt && fields.视觉化描述) {
    imagePrompt = cleanFieldValue(fields.视觉化描述);
  }

  const canonicalVideoPromptParts = [
    cleanFieldValue(景别),
    cleanFieldValue(运动),
    cleanFieldValue(角度),
    cleanFieldValue(fields.画面描述),
    cleanFieldValue(fields.光影色调),
    cleanFieldValue(fields.画质),
  ].filter(v => v && v.length > 0);
  const legacyVideoPromptParts = [
    cleanFieldValue(运动),
    cleanFieldValue(fields.动作与神态),
  ].filter(v => v && v.length > 0);
  const videoPrompt = cleanFieldValue(fields.视频提示词)
    || (hasCanonicalFields ? canonicalVideoPromptParts.join('，') : '')
    || legacyVideoPromptParts.join('，');


  const characters = fields.人物名称
    ? fields.人物名称.split(/[,，、]/).map(c => c.trim()).filter(c => c)
    : [];
  const props = fields.道具名称 && fields.道具名称.trim() !== '无'
    ? fields.道具名称.split(/[,，、]/).map(p => p.trim()).filter(p => p)
    : [];

  const usesCanonicalFormat = hasCanonicalFields;
  const canonicalOriginalTextParts = [
    fields.shotId,
    时长 ? `时间：${时长}` : '',
    景别 ? `景别：${景别}` : '',
    fields.画面描述 ? `画面描述：${fields.画面描述}` : '',
    imagePrompt ? `分镜生成提示词：${imagePrompt}` : '',
    角度 ? `拍摄角度：${角度}` : '',
    运动 ? `运镜方式：${运动}` : '',
    fields.光影色调 ? `光影色调：${fields.光影色调}` : '',
    fields.画质 ? `画质：${fields.画质}` : '',
    fields.转场 ? `转场：${fields.转场}` : '',
    对白 ? `人声：${对白}` : '',
    fields.音效 ? `音效：${fields.音效}` : '',
    fields.人物名称 ? `人物名称：${fields.人物名称}` : '',
    fields.场景名称 ? `场景名称：${fields.场景名称}` : '',
    fields.道具名称 ? `道具名称：${fields.道具名称}` : '',
    videoPrompt ? `视频提示词：${videoPrompt}` : '',
  ].filter(Boolean).join('\n');
  const legacyOriginalTextParts = [
    fields.shotId,
    时长 ? `时间：${时长}` : '',
    fields.取景 ? `取景：${fields.取景}` : '',
    角度 ? `摄像机角度：${角度}` : '',
    运动 ? `镜头运动：${运动}` : '',
    fields.机位 ? `机位：${fields.机位}` : '',
    fields.站位与构图 ? `站位与构图：${fields.站位与构图}` : '',
    fields.动作与神态 ? `动作与神态：${fields.动作与神态}` : '',
    fields.氛围与特效 ? `氛围与特效：${fields.氛围与特效}` : '',
    fields.人声 ? `人声：${fields.人声}` : '',
    fields.音效 ? `音效：${fields.音效}` : '',
    fields.转场 ? `转场：${fields.转场}` : '',
    fields.场景名称 ? `场景名称：${fields.场景名称}` : '',
    fields.人物名称 ? `人物名称：${fields.人物名称}` : '',
    fields.道具名称 ? `道具名称：${fields.道具名称}` : '',
    fields.视频提示词 ? `视频提示词：${fields.视频提示词}` : ''
  ].filter(Boolean).join('\n');
  const originalTextParts = usesCanonicalFormat
    ? canonicalOriginalTextParts
    : legacyOriginalTextParts;

  const legacyScriptSegmentParts = [
    fields.取景,
    角度,
    fields.站位与构图,
    fields.动作与神态,
  ].filter(Boolean);
  const legacyScriptSegment = legacyScriptSegmentParts.length
    ? `${legacyScriptSegmentParts.slice(0, 2).join('，')}。${legacyScriptSegmentParts.slice(2).join('，')}`.trim()
    : '';
  const scriptSegment = cleanFieldValue(fields.画面描述) || legacyScriptSegment;
  const parsedDurationSeconds = Number.parseFloat(时长);
  const cameraMovement = [景别, 运动, 角度].filter(Boolean).join('，');

  return {
    id: uuidv4(),
    originalText: originalTextParts,
    scriptSegment: scriptSegment.trim() || fields.shotId,
    imagePrompt,
    videoPrompt,
    dialogue: 对白,
    characters,
    scene: fields.场景名称 || '',
    props,
    shotNumber: fields.shotId,
    scriptSegmentId: fields.segmentNo ? `storyboard-segment-${fields.segmentNo}` : undefined,
    sourceVideoShotNo: fields.shotId,
    videoScriptBlock: originalTextParts,
    shotSize: 景别,
    cameraAngle: 角度,
    cameraMovement,
    plannedDurationMs: Number.isFinite(parsedDurationSeconds)
      ? Math.round(parsedDurationSeconds * 1000)
      : null,
    duration: 时长
  };
}


export function parseStoryboardScript(scriptText: string): ParseResult {
  const { completedBlocks, displayText, continueFrom } = parseStreamingBlocks(scriptText + '---CUT---');

  const shots: StoryboardItem[] = completedBlocks.map(convertToStoryboardItem);

  return {
    shots,
    displayText,
    continueFrom,
    rawBlocks: completedBlocks
  };
}


export function updateShotsFromStream(
  existingShots: StoryboardItem[],
  newBlocks: ShotBlockFields[]
): StoryboardItem[] {
  const newShots = newBlocks.map(convertToStoryboardItem);


  const existingShotNumbers = new Set(existingShots.map(s => s.shotNumber));
  const updatedShots = [...existingShots];

  for (const newShot of newShots) {
    if (existingShotNumbers.has(newShot.shotNumber)) {

      const index = updatedShots.findIndex(s => s.shotNumber === newShot.shotNumber);
      if (index !== -1) {
        updatedShots[index] = { ...updatedShots[index], ...newShot, id: updatedShots[index].id };
      }
    } else {

      updatedShots.push(newShot);
    }
  }

  return updatedShots;
}


export function removeControlCharacters(text: string): string {
  return text
    .replace(/---CUT---/g, '')
    .replace(/<<<CONTINUE_FROM\s+镜头\d+(?:-\d+)?>>>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits long input into overlapping shot groups without cutting a shot block. */
export function segmentInputContent(
  content: string,
  shotsPerSegment: number = 10,
  overlapShots: number = 1
): string[] {
  if (!content.trim()) return [];


  const shotPattern = /镜头\s*(\d+(?:\s*[-－—]\s*\d+)?)/g;
  const matches = [...content.matchAll(shotPattern)];


  if (matches.length === 0) {
    return segmentByParagraphs(content, shotsPerSegment);
  }

  console.log(`📊 检测到 ${matches.length} 个镜头标识`);


  if (matches.length <= shotsPerSegment) {
    return [content];
  }

  const segments: string[] = [];


  for (let i = 0; i < matches.length; i += shotsPerSegment - overlapShots) {
    const startMatch = matches[i];
    const endIndex = Math.min(i + shotsPerSegment, matches.length);
    const endMatch = matches[endIndex - 1];


    const startPos = startMatch.index!;


    let endPos: number;
    if (endIndex < matches.length) {

      endPos = matches[endIndex].index!;
    } else {

      endPos = content.length;
    }

    const segment = content.substring(startPos, endPos).trim();
    if (segment) {
      segments.push(segment);
      console.log(`📎 分段 ${segments.length}: 镜头 ${startMatch[1]} - ${endMatch[1]} (${segment.length} 字符)`);
    }


    if (endIndex >= matches.length) break;
  }

  return segments;
}


function segmentByParagraphs(content: string, itemsPerSegment: number): string[] {

  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());

  if (paragraphs.length <= itemsPerSegment) {
    return [content];
  }

  const segments: string[] = [];
  for (let i = 0; i < paragraphs.length; i += itemsPerSegment) {
    const segment = paragraphs.slice(i, i + itemsPerSegment).join('\n\n');
    if (segment.trim()) {
      segments.push(segment);
    }
  }

  console.log(`📎 按段落分段: ${segments.length} 段`);
  return segments;
}


export function countShots(content: string): number {
  const shotPattern = /镜头\s*\d+(?:\s*[-－—]\s*\d+)?/g;
  const matches = content.match(shotPattern);
  return matches ? matches.length : 0;
}
