import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Image as ImageIcon,
  Info,
  Music2,
  Sparkles,
  Type,
  Video,
} from 'lucide-react';

export interface ModelPickerOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  runtimeLabel?: string;
  group?: string;
  badge?: string;
  available?: boolean;
  unavailableReason?: string;
}

interface ModelPickerProps<T extends string = string> {
  value: T;
  options: readonly ModelPickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  fullWidth?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  subtitle?: string;
  missingValueLabel?: string;
  kind?: 'model' | 'text' | 'image' | 'video' | 'audio';
}

export function splitModelOptionLabel(label: string): { name: string; description: string } {
  const [name, ...description] = String(label || '').split('·').map(part => part.trim()).filter(Boolean);
  return {
    name: name || '选择模型',
    description: description.join(' · '),
  };
}

const PICKER_ICONS = {
  model: Sparkles,
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music2,
} as const;

export function ModelPicker<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  compact = false,
  fullWidth = false,
  className = '',
  ariaLabel = '选择模型',
  title = '模型',
  subtitle = '选择适合当前任务的模型；不可用模型会保留显示并说明原因',
  missingValueLabel,
  kind = 'model',
}: ModelPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 360 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const Icon = PICKER_ICONS[kind];
  const selected = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  );
  const selectedLabel = splitModelOptionLabel(selected?.label || missingValueLabel || String(value));
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, ModelPickerOption<T>[]>();
    options.forEach(option => {
      const group = String(option.group || '').trim();
      groups.set(group, [...(groups.get(group) || []), option]);
    });
    return Array.from(groups.entries());
  }, [options]);

  const refreshPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const desiredWidth = compact ? 320 : Math.max(360, rect.width);
    const width = Math.max(280, Math.min(desiredWidth, window.innerWidth - 24));
    const left = fullWidth
      ? Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
      : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const estimatedHeight = Math.min(460, 76 + options.length * 58 + groupedOptions.length * 26);
    const opensUpward = rect.bottom + estimatedHeight + 12 > window.innerHeight
      && rect.top > estimatedHeight;
    const top = opensUpward
      ? Math.max(12, rect.top - estimatedHeight - 6)
      : Math.min(window.innerHeight - 12, rect.bottom + 6);
    setPosition({ left, top, width });
  }, [compact, fullWidth, groupedOptions.length, options.length]);

  useEffect(() => {
    if (!open) return;
    refreshPosition();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, refreshPosition]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        role="listbox"
        aria-label={ariaLabel}
        className="fixed z-[120] overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <div className="border-b border-n40 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-n800">
            <Icon className="h-3.5 w-3.5 text-primary" />选择{title}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-n100">{subtitle}</div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {groupedOptions.map(([group, rows]) => {
            const isLocalGroup = /本地|集群|节点/i.test(group);
            const GroupIcon = isLocalGroup ? Cpu : Cloud;
            return (
              <section key={group || 'all'} className="mb-2 last:mb-0">
                {group && (
                  <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-n300">
                    <GroupIcon className="h-3 w-3" />{group}
                  </div>
                )}
                <div className="space-y-0.5">
                  {rows.map(option => {
                    const label = splitModelOptionLabel(option.label);
                    const available = option.available !== false;
                    const isSelected = option.value === value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={!available}
                        title={!available ? option.unavailableReason : option.label}
                        onClick={() => {
                          if (!available) return;
                          onChange(option.value);
                          setOpen(false);
                        }}
                        className={`group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          available
                            ? 'hover:bg-p50'
                            : 'cursor-not-allowed bg-n20/80 text-n100 grayscale'
                        } ${isSelected ? 'bg-p50' : ''}`}
                      >
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          available ? 'bg-p75 text-primary' : 'bg-n30 text-n100'
                        }`}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`truncate text-xs font-semibold ${available ? 'text-n800' : 'text-n100'}`}>
                              {label.name}
                            </span>
                            {option.badge && (
                              <span className="shrink-0 rounded bg-n30 px-1.5 py-0.5 text-[9px] font-medium text-n300">{option.badge}</span>
                            )}
                            {!available && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-n30 px-1.5 py-0.5 text-[9px] font-medium text-n100">
                                <Info className="h-2.5 w-2.5" />不可用
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-n100">
                            {available
                              ? (option.description || label.description || option.runtimeLabel || `${title}选项`)
                              : (option.unavailableReason || '当前暂不可用')}
                          </span>
                        </span>
                        {isSelected && <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>,
      document.body,
    )
    : null;

  const triggerDisabled = disabled || options.length === 0;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        data-testid="model-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={triggerDisabled}
        onClick={() => {
          refreshPosition();
          setOpen(current => !current);
        }}
        className={`inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full border border-n40 bg-n0 text-n700 shadow-sm transition-colors hover:border-primary hover:bg-p50 disabled:cursor-not-allowed disabled:bg-n20 disabled:text-n100 disabled:opacity-60 ${
          compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'
        } ${fullWidth ? 'w-full justify-between' : 'max-w-[260px]'} ${selected?.available === false ? 'text-n100' : ''} ${className}`}
        title={selected?.available === false ? selected.unavailableReason : selected?.label}
      >
        <Icon className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-primary`} />
        <span className="min-w-0 flex-1 truncate text-left font-semibold">{selectedLabel.name || '选择模型'}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </>
  );
}
