import React from 'react';
import {
  countPromptCharacters,
  MIN_STABILITY_CONSTRAINT_CHARACTERS,
  MIN_VISUAL_STYLE_CHARACTERS,
} from '../utils/scriptPromptStandards';

interface SegmentPromptCardsProps {
  segmentNo: number;
  visualStyle?: string;
  stabilityConstraint?: string;
}

export const SegmentPromptCards: React.FC<SegmentPromptCardsProps> = ({
  segmentNo,
  visualStyle = '',
  stabilityConstraint = '',
}) => {
  const cards = [
    {
      key: 'visual-style',
      label: '视觉风格',
      value: visualStyle.trim(),
      minimum: MIN_VISUAL_STYLE_CHARACTERS,
      className: 'border-primary/25 bg-primary-light/30',
      labelClassName: 'text-primary',
    },
    {
      key: 'stability-constraint',
      label: '正向稳定约束',
      value: stabilityConstraint.trim(),
      minimum: MIN_STABILITY_CONSTRAINT_CHARACTERS,
      className: 'border-success/25 bg-success-light/40',
      labelClassName: 'text-success',
    },
  ].filter(card => card.value);

  if (cards.length === 0) return null;

  return (
    <div className="space-y-2" data-testid={`segment-${segmentNo}-prompt-cards`}>
      {cards.map(card => {
        const characterCount = countPromptCharacters(card.value);
        return (
          <article
            key={card.key}
            className={`rounded-md border px-3 py-3 ${card.className}`}
            data-testid={`segment-${segmentNo}-${card.key}-card`}
          >
            <header className="mb-2 flex items-center gap-2">
              <span className={`text-xs font-semibold ${card.labelClassName}`}>【{card.label}】</span>
              <span className="ml-auto text-[10px] text-n300">
                {characterCount} 字 · 参考约 {card.minimum} 字
              </span>
            </header>
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-n700">
              {card.value}
            </p>
          </article>
        );
      })}
    </div>
  );
};
