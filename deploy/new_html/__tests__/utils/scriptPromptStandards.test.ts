import { describe, expect, it } from 'vitest';
import {
  CHARACTER_CAST_PLANNING_RULE, CHARACTER_UNIQUENESS_RULE,
  STABILITY_CONSTRAINT_REFERENCE, ensureStabilityConstraintLength,
} from '../../utils/scriptPromptStandards';
import {
  GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT,
  ITERATE_FULL_SCRIPT, RESTRUCTURE_SHOT, REGENERATE_SINGLE_SHOT,
} from '../../prompts/scriptPrompts';
import {
  GENERATE_VIDEO_SCRIPT_FROM_SEGMENT, GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS,
  ITERATE_VIDEO_SCRIPT, REPLAN_INVALID_VIDEO_SCRIPT,
  EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT, REPLAN_INVALID_STORYBOARD_EXTRACTION,
} from '../../prompts/scriptPipelinePrompts';
import { normalizeGeneratedVideoScript, parseVideoScriptGroups } from '../../utils/scriptPipelineParsers';

describe('default character uniqueness and cast planning', () => {
  it('separates cross-shot identity consistency from same-shot duplicate people', () => {
    expect(STABILITY_CONSTRAINT_REFERENCE).toContain(CHARACTER_UNIQUENESS_RULE);
    expect(CHARACTER_UNIQUENESS_RULE).toContain('同一角色在同一镜头内只出现一个实体');
    expect(CHARACTER_UNIQUENESS_RULE).toContain('人物四视图及同一角色的多张参考图只表示同一个人');
    expect(CHARACTER_UNIQUENESS_RULE).toContain('不复制脸、不混脸、不相互替换');
    expect(CHARACTER_UNIQUENESS_RULE).toContain('人数不按参考图数量计算');
    expect(CHARACTER_UNIQUENESS_RULE).toContain('无人物镜头不添加人物');
    expect(CHARACTER_UNIQUENESS_RULE).toContain('只有剧本或用户明确要求时才允许分身、镜面倒影或双胞胎');
  });
  it.each([
    GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT,
    ITERATE_FULL_SCRIPT, RESTRUCTURE_SHOT, REGENERATE_SINGLE_SHOT,
    GENERATE_VIDEO_SCRIPT_FROM_SEGMENT, GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS,
    ITERATE_VIDEO_SCRIPT, REPLAN_INVALID_VIDEO_SCRIPT,
  ])('plans a per-shot cast in every generation/iteration entry point', template => {
    const prompt = `${template.system}\n${template.user}`;
    expect(prompt).toContain(CHARACTER_CAST_PLANNING_RULE);
    expect(prompt).toContain(CHARACTER_UNIQUENESS_RULE);
    expect(CHARACTER_CAST_PLANNING_RULE).toContain('不在画面内的旁白或画外音不计入出场人数');
    expect(CHARACTER_CAST_PLANNING_RULE).toContain('合并镜头时逐镜头分别遵守');
  });
  it.each([EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT, REPLAN_INVALID_STORYBOARD_EXTRACTION])('carries identity/count constraints into extracted image prompts', template => {
    expect(template.user).toContain(CHARACTER_UNIQUENESS_RULE);
    expect(template.user).not.toContain(CHARACTER_CAST_PLANNING_RULE);
  });
  it('does not overwrite a complete historical/user-written constraint or explicit exception', () => {
    const legacy = STABILITY_CONSTRAINT_REFERENCE.replace(CHARACTER_UNIQUENESS_RULE, '')
      + '本镜头明确要求女主与镜中倒影同时出现，两个人物影像。';
    expect(ensureStabilityConstraintLength(legacy)).toBe(legacy);
    expect(ensureStabilityConstraintLength('')).toBe('');
    expect(ensureStabilityConstraintLength(STABILITY_CONSTRAINT_REFERENCE)).toBe(STABILITY_CONSTRAINT_REFERENCE);
  });
  it('fills missing generated defaults without changing visible cast, counts or explicit reflections', () => {
    const scenes = [
      '出场：队员A、队员B，共2人。队员A在左侧整理背包，队员B在右侧看表。旁白在画外。',
      '出场：女主1人及剧本明确要求的镜中倒影1个。女主抬手，镜中倒影同步抬手。',
      '空镜：可见人数0人，桌上放着背包。',
    ];
    const draft = scenes.map((scene, i) => [
      `分段${i + 1}`, `镜头${i + 1}-1`, '时长（秒）：4', `画面描述：${scene}`,
    ].join('\n')).join('\n\n');
    const normalized = normalizeGeneratedVideoScript(draft);
    const groups = parseVideoScriptGroups(normalized);
    expect(groups).toHaveLength(3);
    groups.forEach((group, i) => {
      expect(group.rawGroup).toContain(scenes[i]);
      expect(group.stabilityConstraint).toContain(CHARACTER_UNIQUENESS_RULE);
      expect(group.blocks).toHaveLength(1);
      expect(group.blocks[0].durationSec).toBe(4);
    });
    expect(normalizeGeneratedVideoScript(normalized)).toBe(normalized);
  });
});
