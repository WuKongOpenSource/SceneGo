import type {
  AudioClipInfo,
  StoryboardAudioSegment,
  StoryboardItemDB,
} from '../types';
import { extractSpokenDialogue, stripDialogueMarkers } from './scriptPipelineParsers';

const SILENCE_LINE_RE = /^(?:[\[(（【]\s*)?(?:无声动作|无声|静默|停顿|间隔|空镜)(?:\s*[:：-]\s*([^)\]）】]*?))?\s*(\d+(?:\.\d+)?)\s*(?:秒|s)(?:\s*[\])）】])?$/i;
const PLACEHOLDER_RE = /^(?:无|无台词|无对白|\(无台词\))$/;

function positiveDurationMs(value: unknown): number | null {
  const durationMs = Number(value);
  return Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
}

function stableSegmentId(itemId: string, kind: StoryboardAudioSegment['kind'], index: number): string {
  return `${itemId}:${kind}:${index + 1}`;
}

export function normalizeStoryboardAudioSegments(
  value: unknown,
  itemId: string,
): StoryboardAudioSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw, index): StoryboardAudioSegment | null => {
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      const kind = record.kind === 'silence' ? 'silence' : record.kind === 'speech' ? 'speech' : null;
      if (!kind) return null;
      const sequenceIndex = Number.isFinite(Number(record.sequenceIndex ?? record.sequence_index))
        ? Number(record.sequenceIndex ?? record.sequence_index)
        : index;
      const segmentId = String(record.segmentId ?? record.segment_id ?? stableSegmentId(itemId, kind, index));
      return {
        segmentId,
        kind,
        sequenceIndex,
        speaker: typeof record.speaker === 'string' ? record.speaker : undefined,
        text: typeof record.text === 'string' ? record.text : undefined,
        label: typeof record.label === 'string' ? record.label : undefined,
        audioUrl: typeof (record.audioUrl ?? record.audio_url) === 'string'
          ? String(record.audioUrl ?? record.audio_url)
          : null,
        durationMs: positiveDurationMs(record.durationMs ?? record.duration_ms),
        voiceId: typeof (record.voiceId ?? record.voice_id) === 'string'
          ? String(record.voiceId ?? record.voice_id)
          : null,
      };
    })
    .filter((segment): segment is StoryboardAudioSegment => segment != null)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map((segment, sequenceIndex) => ({ ...segment, sequenceIndex }));
}

function parseSilenceLine(line: string): { label: string; durationMs: number } | null {
  const match = line.trim().match(SILENCE_LINE_RE);
  if (!match) return null;
  const seconds = Number(match[2]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    label: (match[1] || '无声动作').trim(),
    durationMs: Math.round(seconds * 1000),
  };
}

export function parseLegacyDialogueSegments(
  item: StoryboardItemDB,
  knownCharacters: string[] = [],
): StoryboardAudioSegment[] {
  const source = String(item.dialogue || '').trim();
  if (!source || PLACEHOLDER_RE.test(source)) return [];

  const segments: StoryboardAudioSegment[] = [];
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const originalLine of lines) {
    const silence = parseSilenceLine(originalLine);
    if (silence) {
      segments.push({
        segmentId: stableSegmentId(item.itemId, 'silence', segments.length),
        kind: 'silence',
        sequenceIndex: segments.length,
        label: silence.label,
        durationMs: silence.durationMs,
      });
      continue;
    }

    const line = stripDialogueMarkers(originalLine);
    if (!line || PLACEHOLDER_RE.test(line)) continue;
    const parsed = extractSpokenDialogue(line, knownCharacters);
    const hasExplicitSpeaker = parsed.speaker && parsed.text !== line;
    if (!hasExplicitSpeaker && segments.at(-1)?.kind === 'speech') {
      const previous = segments[segments.length - 1];
      previous.text = `${previous.text || ''}\n${parsed.text || line}`.trim();
      continue;
    }

    const speaker = parsed.speaker || knownCharacters[0] || '旁白';
    segments.push({
      segmentId: stableSegmentId(item.itemId, 'speech', segments.length),
      kind: 'speech',
      sequenceIndex: segments.length,
      speaker,
      text: parsed.text || line,
      audioUrl: null,
      durationMs: null,
      voiceId: null,
    });
  }

  const speechSegments = segments.filter(segment => segment.kind === 'speech');
  if (speechSegments.length === 1) {
    const only = speechSegments[0];
    const isNarration = (only.speaker || '') === '旁白';
    only.audioUrl = isNarration ? item.narrationAudioUrl : item.dialogueAudioUrl;
    only.durationMs = only.audioUrl ? item.audioDurationMs : null;
  }
  return segments;
}

export function resolveStoryboardAudioSegments(
  item: StoryboardItemDB,
  knownCharacters: string[] = [],
): StoryboardAudioSegment[] {
  const persisted = normalizeStoryboardAudioSegments(item.audioSegments, item.itemId);
  return persisted.length > 0 ? persisted : parseLegacyDialogueSegments(item, knownCharacters);
}

export function audioSegmentsToClips(
  item: StoryboardItemDB,
  segments: StoryboardAudioSegment[],
  resolveVoiceId: (speaker: string) => string | null,
): AudioClipInfo[] {
  return segments
    .filter((segment): segment is StoryboardAudioSegment & { kind: 'speech' } => segment.kind === 'speech')
    .map(segment => {
      const speaker = segment.speaker || '旁白';
      return {
        clipId: segment.segmentId,
        itemId: item.itemId,
        lineageId: item.lineageId,
        sortOrder: item.sortOrder,
        sequenceIndex: segment.sequenceIndex,
        type: speaker === '旁白' ? 'narration' : 'dialogue',
        text: segment.text || '',
        characterName: speaker,
        audioUrl: segment.audioUrl || null,
        durationMs: positiveDurationMs(segment.durationMs),
        voiceId: segment.voiceId || resolveVoiceId(speaker),
      };
    });
}

export function serializeAudioSegmentsDialogue(segments: StoryboardAudioSegment[]): string {
  return [...segments]
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map(segment => {
      if (segment.kind === 'silence') {
        const seconds = Math.max(0, Number(segment.durationMs || 0)) / 1000;
        return `（无声动作：${seconds}秒${segment.label && segment.label !== '无声动作' ? `，${segment.label}` : ''}）`;
      }
      return `${segment.speaker || '旁白'}：${segment.text || ''}`;
    })
    .join('\n');
}

export function sumPersistedAudioSegmentDurationMs(segments: StoryboardAudioSegment[]): number {
  return segments.reduce(
    (total, segment) => total + (positiveDurationMs(segment.durationMs) || 0),
    0,
  );
}
