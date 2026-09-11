import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../admin/AdminHubPage.tsx'), 'utf-8');

describe('AdminHubPage entry card layout', () => {
  it('stretches both the grid item wrapper and the visible card to the row height', () => {
    expect(source).toContain('group relative h-full bg-n0');
    expect(source).toContain('className="block h-full">{inner}</a>');
    expect(source).toContain('className="block h-full">{inner}</div>');
  });
});
