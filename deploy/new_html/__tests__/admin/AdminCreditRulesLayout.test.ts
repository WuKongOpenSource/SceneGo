import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/AdminFeatureTabs.tsx'), 'utf-8');

describe('admin credit rules table layout', () => {
  it('uses matching fixed widths and centered alignment for base, min, and max', () => {
    expect(source.match(/<th className="w-24 text-center font-medium p-2\.5">(?:base|min|max)<\/th>/g)).toHaveLength(3);
    expect(source.match(/<td className="w-24 p-2\.5 text-center"><input type="number"/g)).toHaveLength(3);
    expect(source.match(/className="mx-auto block w-16 [^"]* text-center text-xs/g)).toHaveLength(3);
  });
});
