import React from 'react';
export type SeedreamPurpose = 'character_four_view' | 'pure_background';

export function SeedreamPurposeControl({ value, onChange }: {
  value?: SeedreamPurpose; onChange: (value?: SeedreamPurpose) => void;
}) {
  return <div className="space-y-2 rounded-lg bg-primary-light p-3 text-xs">
    <label className="flex flex-wrap items-center gap-2">素材用途
      <select aria-label="Seedream 素材用途" value={value || ''}
        onChange={event => onChange((event.target.value || undefined) as SeedreamPurpose | undefined)}
        className="rounded border border-n40 bg-n0 px-2 py-1">
        <option value="">普通生图</option>
        <option value="character_four_view">真人参考 · 人物四视图（纯文生图）</option>
        <option value="pure_background">真人参考 · 纯背景（纯文生图）</option>
      </select>
    </label>
    {value && <p className="leading-5 text-n300">单张纯文生图，不发送任何参考图片、不自动切换模型。原图保存后可用于 Seedance 2.0、Fast、Mini 全能参考；需同时选人物四视图与纯背景，30 天内有效。已有素材保持不变，最终仍以上游审核为准。</p>}
  </div>;
}
