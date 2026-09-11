import { describe, expect, it } from 'vitest';
import {
  buildScriptVersionChainContext,
  buildScriptIterationContext,
  analyzeScriptIterationScope,
  ensureStoryboardCutSeparators,
  normalizeScriptIterationResult,
  selectScriptIterationBaseVersion,
  stabilizeScriptIterationResult,
} from '../../utils/scriptIteration';
import type { ScriptConversation } from '../../types';
import {
  CONTINUE_STORYBOARD_SCRIPT,
  GENERATE_STORYBOARD_SCRIPT,
  ITERATE_FULL_SCRIPT,
} from '../../prompts/scriptPrompts';
import {
  COMPUTER_OPERATION_ORIENTATION_RULE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';

describe('script iteration helpers', () => {
  it('keeps recent conversation instructions in a compact context', () => {
    const context = buildScriptIterationContext([
      { role: 'user', content: '让第一场冲突更强。' },
      { role: 'assistant', content: '已生成候选版本。' },
      { role: 'user', content: '保留原来的结尾。' },
    ]);

    expect(context).toContain('用户：让第一场冲突更强。');
    expect(context).toContain('系统：已生成候选版本。');
    expect(context).toContain('用户：保留原来的结尾。');
  });

  it('uses an explicit first-turn marker and strips markdown fences', () => {
    expect(buildScriptIterationContext([])).toBe('（首次修改，无历史意见）');
    expect(normalizeScriptIterationResult('```text\n第一场\n```')).toBe('第一场');
  });

  it('continues from the latest draft and injects the ordered version requirement chain', () => {
    const conversation = {
      scriptId: 'script_1',
      currentVersionId: 'ver_2',
      messages: [
        { id: 'user_1', role: 'user', content: '原始故事', status: 'completed', createdAt: 1, updatedAt: 1 },
        { id: 'assistant_1', role: 'assistant', content: 'V1', status: 'completed', replyToMessageId: 'user_1', createdAt: 2, updatedAt: 2 },
        { id: 'user_2', role: 'user', content: '分镜1保持不变，分镜2增加到三个镜头。', status: 'completed', createdAt: 3, updatedAt: 3 },
        { id: 'assistant_2', role: 'assistant', content: 'V2', status: 'completed', replyToMessageId: 'user_2', createdAt: 4, updatedAt: 4 },
        { id: 'user_3', role: 'user', content: '分镜2累计时长再增加三秒。', status: 'completed', createdAt: 5, updatedAt: 5 },
        { id: 'assistant_3', role: 'assistant', content: 'V3', status: 'completed', replyToMessageId: 'user_3', createdAt: 6, updatedAt: 6 },
      ],
      versions: [
        {
          id: 'ver_1', scriptId: 'script_1', messageId: 'assistant_1', versionNo: 1,
          content: '分段1\n人物名称：阿亮\n场景名称：茶馆', storyboardItems: [], source: 'ai', status: 'ready',
          createdAt: 2, updatedAt: 2,
        },
        {
          id: 'ver_2', scriptId: 'script_1', messageId: 'assistant_2', versionNo: 2, baseVersionId: 'ver_1',
          content: '分段1\n人物名称：阿亮、女店主\n场景名称：茶馆室内', storyboardItems: [], source: 'ai', status: 'ready',
          createdAt: 4, updatedAt: 4,
        },
        {
          id: 'ver_3', scriptId: 'script_1', messageId: 'assistant_3', versionNo: 3, baseVersionId: 'ver_2',
          content: '分段1\n人物名称：阿亮、女店主\n场景名称：茶馆室内\n道具名称：木质菜单板', storyboardItems: [], source: 'ai', status: 'draft',
          createdAt: 6, updatedAt: 6,
        },
      ],
    } satisfies ScriptConversation;

    const baseVersion = selectScriptIterationBaseVersion(conversation);
    const context = buildScriptVersionChainContext(conversation, baseVersion);

    expect(baseVersion?.id).toBe('ver_3');
    expect(context).toContain('本轮当前正文基线：V3');
    expect(context).toContain('V2（已采纳/可用，来源 V1）');
    expect(context).toContain('对应修改要求：分镜1保持不变，分镜2增加到三个镜头。');
    expect(context).toContain('对应修改要求：分镜2累计时长再增加三秒。');
    expect(context).toContain('必须继承的内容关键词：人物名称：阿亮、女店主；场景名称：茶馆室内');
    expect(context).toContain('不要重新从最初剧本生成');
  });

  it('does not continue a stale draft from a different selected-version branch', () => {
    const conversation = {
      scriptId: 'script_1',
      currentVersionId: 'ver_2',
      messages: [],
      versions: [
        { id: 'ver_1', scriptId: 'script_1', versionNo: 1, content: 'V1', storyboardItems: [], source: 'ai', status: 'ready', createdAt: 1, updatedAt: 1 },
        { id: 'ver_2', scriptId: 'script_1', versionNo: 2, baseVersionId: 'ver_1', content: 'V2', storyboardItems: [], source: 'ai', status: 'ready', createdAt: 2, updatedAt: 2 },
        { id: 'ver_3', scriptId: 'script_1', versionNo: 3, baseVersionId: 'ver_1', content: 'stale branch', storyboardItems: [], source: 'ai', status: 'draft', createdAt: 3, updatedAt: 3 },
      ],
    } satisfies ScriptConversation;

    expect(selectScriptIterationBaseVersion(conversation)?.id).toBe('ver_2');
  });

  it('restores missing CUT delimiters between standalone shot headers', () => {
    const normalized = ensureStoryboardCutSeparators([
      '镜头01',
      '人声：甲：“你好。”',
      '时间：2秒',
      '镜头02',
      '人声：乙：“你好。”',
      '时间：2秒',
    ].join('\n'));

    expect(normalized).toContain('时间：2秒\n---CUT---\n镜头02');
  });

  it('restores missing CUT delimiters between stage-two storyboard headers', () => {
    const normalized = ensureStoryboardCutSeparators([
      '分镜1-1',
      '时长（秒）：8',
      '画面描述：孙悟空挥棒破云。',
      '分镜1-2',
      '时长（秒）：6',
      '画面描述：南天门震颤。',
    ].join('\n'));

    expect(normalized).toContain('画面描述：孙悟空挥棒破云。\n---CUT---\n分镜1-2');
  });

  it('places a missing CUT before a new segment heading', () => {
    const normalized = ensureStoryboardCutSeparators([
      '分段01',
      '镜头01',
      '时间：8秒',
      '分段02',
      '镜头02',
      '时间：5秒',
    ].join('\n'));

    expect(normalized).toContain('时间：8秒\n---CUT---\n分段02\n镜头02');
  });

  it('allows every revision turn to adjust shot count for the current creative request', () => {
    const text = `${ITERATE_FULL_SCRIPT.system || ''}\n${ITERATE_FULL_SCRIPT.user}`;
    expect(text).toContain('不得被上一版本的镜头总数限制');
    expect(text).toContain('允许依据本轮意见自由调整镜头数量');
    expect(text).not.toContain('镜头总数必须保持不变');
    expect(text).toContain('版本继承链与历史约束');
    expect(text).toContain('不得因本轮未重复提及而丢失或回退');
  });

  it('locks untouched segments and applies an exact targeted shot-count change', () => {
    const current = [
      '分段1',
      '镜头1-1',
      '时间：5秒',
      '景别：中景',
      '画面描述：必须保持的第一段。',
      '分段2',
      '镜头2-1',
      '时间：3秒',
      '景别：近景',
      '画面描述：原来的第二段。',
    ].join('\n');
    const candidate = [
      '分段1',
      '镜头1-1',
      '时间：2秒',
      '景别：远景',
      '画面描述：模型错误改写了第一段。',
      '分段2',
      '镜头2-1',
      '时间：3秒',
      '景别：近景',
      '画面描述：第二段镜头一。',
      '镜头2-2',
      '时间：3秒',
      '景别：中景',
      '画面描述：第二段镜头二。',
      '镜头2-3',
      '时间：3秒',
      '景别：特写',
      '画面描述：第二段镜头三。',
    ].join('\n');

    const scope = analyzeScriptIterationScope('分镜1不变，分镜2变成3个镜头，并增加一些时间');
    const stabilized = stabilizeScriptIterationResult(
      current,
      candidate,
      '分镜1不变，分镜2变成3个镜头，并增加一些时间',
    );

    expect(scope.lockedSegmentNumbers).toEqual([1]);
    expect(scope.targetSegmentNumbers).toEqual([2]);
    expect(scope.expectedShotCounts).toEqual({ 2: 3 });
    expect(stabilized).toContain('画面描述：必须保持的第一段。');
    expect(stabilized).not.toContain('模型错误改写了第一段');
    expect(stabilized).toContain('镜头2-3');
  });

  it('rejects a targeted revision that drops the requested shots', () => {
    const current = '分段1\n镜头1-1\n时间：3秒\n画面描述：第一段。\n分段2\n镜头2-1\n时间：3秒\n画面描述：第二段。';
    const invalidCandidate = '分段1\n镜头1-1\n时间：3秒\n画面描述：第一段。\n分段2\n镜头2-1\n时间：4秒\n画面描述：只生成一个镜头。';

    expect(() => stabilizeScriptIterationResult(
      current,
      invalidCandidate,
      '分镜1不变，分镜2变成3个镜头，并增加一些时间',
    )).toThrow('分镜2应生成3个镜头，实际生成1个');
  });

  it('requires dialogue-aware timing in initial, continued, and revised storyboards', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT, ITERATE_FULL_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('中文');
      expect(text).toContain('4 字/秒');
      expect(text).toContain('8 字符/秒');
    });
  });

  it('requires explicit storyboard segments capped near fifteen seconds', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT, ITERATE_FULL_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toMatch(/分段(?:XX|N)/);
      expect(text).toContain('15 秒');
    });
  });

  it('requires one complete production constraint footer for every segment', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('【视觉风格】');
      expect(text).toContain('【正向稳定约束】');
      expect(text).toContain('每个分段');
      expect(text).toContain('约25字');
      expect(text).toContain('约200字');
    });
  });

  it('uses the new three-step storyboard fields instead of obsolete description groups', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain('剧本拆分');
      expect(text).toContain('分镜提取');
      expect(text).toContain('视频脚本');
      expect(text).toContain('分镜生成提示词');
      expect(text).toContain('拍摄角度');
      expect(text).toContain('运镜方式');
      expect(text).toContain('光影色调');
      expect(text).toContain('不得输出“站位与构图”');
      expect(text).not.toContain('站位与构图至少');
      expect(text).not.toContain('动作与神态至少');
    });
  });

  it('uses the complete reference constraints and hierarchical shot numbers without output markers', () => {
    const text = `${GENERATE_STORYBOARD_SCRIPT.system || ''}\n${GENERATE_STORYBOARD_SCRIPT.user}`;
    expect(text).toContain('镜头1-1');
    expect(text).toContain(VISUAL_STYLE_REFERENCE);
    expect(text).not.toContain('古风写实，暖黄暗调');
    expect(text).toContain('同一场景内，所有镜头的摄影机机位、人物朝向');
    expect(text).not.toContain('---CUT---');
    expect(text).not.toContain('<<<CONTINUE_FROM');
  });

  it('preserves style prompts explicitly inserted by the user into a concrete shot', () => {
    const text = `${GENERATE_STORYBOARD_SCRIPT.system || ''}\n${GENERATE_STORYBOARD_SCRIPT.user}`;
    expect(text).toContain('用户已经在具体分镜中主动填写、追加或确认的提示词属于用户原始内容');
    expect(text).toContain('必须原样保留');
    expect(text).toContain('不得以清理风格词为由删除、替换或改写');
  });

  it('keeps computer screens facing the operator in initial and continued storyboards', () => {
    [GENERATE_STORYBOARD_SCRIPT, CONTINUE_STORYBOARD_SCRIPT].forEach((prompt) => {
      const text = `${prompt.system || ''}\n${prompt.user}`;
      expect(text).toContain(COMPUTER_OPERATION_ORIENTATION_RULE);
      expect(text).toContain('即使剧本写明“屏幕上显示某内容”');
    });
  });
});
