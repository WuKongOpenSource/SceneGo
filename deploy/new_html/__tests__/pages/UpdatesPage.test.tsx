import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

describe('public updates route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it.each(['/updates', '/updates/'])('opens %s without login or private API requests', async path => {
    const fetch = vi.fn().mockRejectedValue(new Error('Unexpected private API request'));
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState({}, '', path);
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: '更新记录' })).toBeVisible();
    expect(screen.getByRole('link', { name: '← 返回创作平台' })).toHaveAttribute('href', '/projects');
    expect(container.querySelector('.platform-content')).toBeInTheDocument();
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(path);
  });
});
