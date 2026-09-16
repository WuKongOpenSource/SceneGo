import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpCenterPage, { HelpMarkdown } from '../../pages/HelpCenterPage';
import { HELP_CATALOG_URL, helpHeadings, loadHelpCatalog, safeHelpUrl, searchHelpDocuments } from '../../help/helpContent';

const catalog = {
  version: 1, updatedAt: '2026-09-16', sourceRevision: 'abc',
  categories: [{ id: 'manual', title: '操作手册', description: '图文说明' }, { id: 'deployment', title: '开源部署', description: '部署说明' }],
  documents: [
    { id: 'manual-01', title: '登录注册', category: 'manual', summary: '如何登录创剧', body: '## 手机验证\n\n先输入手机号。\n\n![登录界面](/assets/help/media/login.webp)', source: '操作手册' },
    { id: 'manual-02', title: '字幕设置', category: 'manual', summary: '编辑字幕样式', body: '## 背景透明度\n\n支持修改所有字幕。\n\n[阅读部署](/tools/help/install)', source: '操作手册' },
    { id: 'install', title: '安装与配置', category: 'deployment', summary: '自行部署', body: '## 数据库\n\n配置 PostgreSQL 与 Redis。', source: '开源文档' },
  ],
};

function open(path = '/tools/help') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/tools/help" element={<HelpCenterPage />} />
    <Route path="/tools/help/:documentId" element={<HelpCenterPage />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => catalog })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Chinese help center', () => {
  it('loads static content only and searches full body with category filters', async () => {
    open();
    expect(await screen.findByText('3 篇文档')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索帮助文档' }), { target: { value: '透明度' } });
    expect(await screen.findByText('1 篇文档')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /字幕设置/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /安装与配置/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    fireEvent.click(screen.getByRole('link', { name: '开源部署' }));
    expect(await screen.findByText('1 篇文档')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /安装与配置/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(HELP_CATALOG_URL, expect.objectContaining({ cache: 'no-cache', signal: expect.any(AbortSignal) }));
  });

  it('supports direct article URLs, internal links, contents and previous/next reading', async () => {
    open('/tools/help/manual-02');
    expect(await screen.findByRole('heading', { level: 1, name: '字幕设置' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '背景透明度' })).toHaveAttribute('id', 'help-背景透明度');
    expect(screen.getByRole('link', { name: /上一篇登录注册/ })).toHaveAttribute('href', '/tools/help/manual-01');
    fireEvent.click(screen.getByRole('link', { name: '阅读部署' }));
    expect(await screen.findByRole('heading', { level: 1, name: '安装与配置' })).toBeInTheDocument();
  });

  it('has retryable failures, does not show raw network errors, and aborts on unmount', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('sensitive network diagnostic'));
    const result = open();
    expect(await screen.findByRole('alert')).toHaveTextContent('帮助文档暂时无法加载');
    expect(screen.queryByText(/sensitive/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByText('3 篇文档');
    const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    result.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('explains missing articles and empty search results', async () => {
    open('/tools/help/no-such-document');
    expect(await screen.findByText(/未找到这篇文档/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '返回文档中心' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索帮助文档' }), { target: { value: '不存在的内容' } });
    expect(await screen.findByText(/没有找到相关文档/)).toBeInTheDocument();
  });

  it('shows a fallback when copying fails and uses lazy local images', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    open('/tools/help/manual-01');
    const image = await screen.findByAltText('登录界面');
    expect(image).toHaveAttribute('loading', 'lazy');
    fireEvent.click(screen.getByRole('button', { name: '复制文档链接' }));
    expect(await screen.findByText(/从浏览器地址栏复制/)).toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.getByText(/配图暂时无法加载/)).toBeInTheDocument();
  });

  it('renders tables and code but never executes HTML or accepts tracking images', () => {
    const body = '## 同名\n\n## 同名\n\n<script>bad()</script>\n\n[坏链接](javascript:alert(1))\n\n![追踪](https://tracker.example/x.png)\n\n| 参数 | 说明 |\n| --- | --- |\n| A | 中文 |\n\n```sh\n echo test\n```';
    const { container } = render(<React.StrictMode><MemoryRouter><HelpMarkdown body={body} /></MemoryRouter></React.StrictMode>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('img[src^="https:"]')).toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('中文');
    expect(container.querySelector('pre')).toHaveTextContent('echo test');
    expect(screen.getAllByRole('heading').map(h => h.id)).toEqual(['help-同名', 'help-同名-1']);
  });

  it('ignores headings inside fences and finds Chinese and case-insensitive technical text', () => {
    expect(helpHeadings('## 可见\n````js\n## 隐藏\n```\n## 仍隐藏\n````\n## 可见')).toEqual([
      { title: '可见', id: 'help-可见', level: 2, line: 1 }, { title: '可见', id: 'help-可见-1', level: 2, line: 7 },
    ]);
    expect(searchHelpDocuments(catalog.documents, 'postgresql redis').map(doc => doc.id)).toEqual(['install']);
    expect(safeHelpUrl('//evil.example')).toBe('');
    expect(safeHelpUrl('data:text/html,bad')).toBe('');
    expect(safeHelpUrl('file:///private')).toBe('');
    expect(safeHelpUrl('/assets/help/../private')).toBe('');
  });

  it('rejects corrupt catalog responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ version: 9 }) } as Response);
    await expect(loadHelpCatalog(new AbortController().signal)).rejects.toThrow('帮助文档暂时无法加载');
  });
});
