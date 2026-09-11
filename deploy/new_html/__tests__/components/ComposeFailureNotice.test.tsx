import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComposeFailureNotice } from '../../components/ComposeFailureNotice';

describe('composition failure details', () => {
  afterEach(cleanup);

  it('shows the server reason visibly instead of relying on hover', () => {
    render(<ComposeFailureNotice error="配音素材不存在，请重新选择。" />);
    expect(screen.getByRole('alert')).toHaveTextContent('合成失败：配音素材不存在，请重新选择。');
  });

  it.each([undefined, null, '', '   '])('provides a useful fallback for %s', error => {
    render(<ComposeFailureNotice error={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent('未返回详细原因，请检查素材后重试。');
  });

  it('renders untrusted error content as text and keeps processing terminology', () => {
    const view = render(<ComposeFailureNotice error={'ComfyUI <script>alert(1)</script>'} />);
    expect(screen.getByRole('alert')).toHaveTextContent('处理服务 <script>alert(1)</script>');
    expect(view.container.querySelector('script')).toBeNull();
  });

  it.each(['EnhancePage', 'FinalProductPage'])('uses the visible notice on %s', page => {
    const source = readFileSync(resolve(__dirname, `../../pages/${page}.tsx`), 'utf-8');
    expect(source).toContain('<ComposeFailureNotice error={compose.error} />');
    expect(source).not.toContain("title={sanitizeProcessingTerminology(compose.error || '')}");
  });
});
