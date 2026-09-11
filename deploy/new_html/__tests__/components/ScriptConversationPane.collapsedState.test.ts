import { describe, expect, it } from 'vitest';
import { setCollapsedEntry } from '../../components/ScriptConversationPane';

describe('ScriptConversationPane collapsed state', () => {
  it('keeps a message expanded when duplicate expand events arrive', () => {
    const key = 'file-1:version:version-1';
    const collapsed = new Set([key]);

    const expanded = setCollapsedEntry(collapsed, key, false);
    const duplicateExpanded = setCollapsedEntry(expanded, key, false);

    expect(expanded.has(key)).toBe(false);
    expect(duplicateExpanded.has(key)).toBe(false);
    expect(duplicateExpanded).toBe(expanded);
  });

  it('keeps a message collapsed when duplicate collapse events arrive', () => {
    const key = 'file-1:version:version-1';

    const collapsed = setCollapsedEntry(new Set<string>(), key, true);
    const duplicateCollapsed = setCollapsedEntry(collapsed, key, true);

    expect(collapsed.has(key)).toBe(true);
    expect(duplicateCollapsed.has(key)).toBe(true);
    expect(duplicateCollapsed).toBe(collapsed);
  });
});
