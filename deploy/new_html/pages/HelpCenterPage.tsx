import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, ExternalLink, Search, X } from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { helpHeadingId, helpHeadings, loadHelpCatalog, safeHelpUrl, searchHelpDocuments, type HelpCatalog } from '../help/helpContent';
import '../help/help-center.css';

function textOf(node: React.ReactNode): string {
  return React.Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number'
    ? String(child) : React.isValidElement<{ children?: React.ReactNode }>(child) ? textOf(child.props.children) : '').join('');
}

const HelpImage: React.FC<{ src?: string; alt?: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="help-image-error">配图暂时无法加载：{alt || '操作示意图'}</span>;
  return <a href={src} target="_blank" rel="noopener noreferrer" title="查看大图">
    <img src={src} alt={alt || '操作示意图'} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </a>;
};

export const HelpMarkdown = React.memo(function HelpMarkdown({ body }: { body: string }) {
  const headings = helpHeadings(body);
  const heading = (level: number) => ({ children, node }: { children?: React.ReactNode; node?: { position?: { start: { line: number } } } }) => {
    const id = headings.find(item => item.line === node?.position?.start.line)?.id || helpHeadingId(textOf(children));
    return React.createElement(`h${level}`, { id }, children);
  };
  const components: Components = {
    h1: heading(2), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      if (href.startsWith('/tools/help')) return <Link to={href}>{children}</Link>;
      return <a href={href} {...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{children}</a>;
    },
    img: ({ src, alt }) => <HelpImage key={src} src={src} alt={alt} />,
    table: ({ children }) => <div className="help-table-scroll"><table>{children}</table></div>,
  };
  return <div className="help-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url, key) => safeHelpUrl(url, key === 'src')} components={components}>{body}</Markdown></div>;
});

const HelpCenterPage: React.FC = () => {
  const { documentId } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const category = params.get('category') || '';
  const deferredQuery = useDeferredValue(query);
  const [catalog, setCatalog] = useState<HelpCatalog | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    loadHelpCatalog(controller.signal).then(data => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  const document = catalog?.documents.find(doc => doc.id === documentId);
  const results = useMemo(() => searchHelpDocuments(catalog?.documents || [], deferredQuery, category), [catalog, deferredQuery, category]);
  const siblings = catalog?.documents.filter(doc => doc.category === document?.category) || [];
  const siblingIndex = siblings.findIndex(doc => doc.id === documentId);
  const previous = siblings[siblingIndex - 1];
  const next = siblings[siblingIndex + 1];
  const headings = useMemo(() => helpHeadings(document?.body || '').filter(item => item.level <= 3), [document]);

  useEffect(() => {
    setCopied(false); setCopyError(false);
    if (location.hash) {
      try { scrollRef.current?.querySelectorAll('[id]').forEach(element => {
        if (element.id === decodeURIComponent(location.hash.slice(1))) element.scrollIntoView?.({ block: 'start' });
      }); } catch { /* An invalid fragment cannot prevent reading the article. */ }
    } else if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [document, location.hash]);

  const updateFilter = (key: string, value: string) => {
    const updated = new URLSearchParams(params);
    if (value) updated.set(key, value); else updated.delete(key);
    setParams(updated, { replace: true });
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };

  return <div className="help-center" ref={scrollRef}>
    <div className="help-inner">
      <header className="help-hero">
        <div className="help-eyebrow"><BookOpen size={16} /> 创剧使用指南</div>
        <h2>从第一个想法，到完整成片</h2>
        <p>操作手册、常见问题和开源部署文档，都在这里。</p>
        <div className="help-search">
          <Search size={19} aria-hidden="true" />
          <input aria-label="搜索帮助文档" placeholder="搜索操作、功能或配置参数…" value={query}
            onChange={event => updateFilter('q', event.target.value)} />
          {query && <button type="button" aria-label="清空搜索" onClick={() => updateFilter('q', '')}><X size={17} /></button>}
        </div>
      </header>

      {!catalog && !error && <p role="status">正在加载帮助文档…</p>}
      {error && <div role="alert" className="help-empty">帮助文档暂时无法加载，请检查网络后重试。
        <button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>}

      {catalog && <>
        <nav className="help-categories" aria-label="帮助文档分类">
          <Link className={!category && !documentId ? 'active' : ''} to="/tools/help">全部文档</Link>
          {catalog.categories.map(item => <Link key={item.id}
            className={(category || document?.category) === item.id ? 'active' : ''}
            to={`/tools/help?category=${item.id}${query ? `&q=${encodeURIComponent(query)}` : ''}`}>{item.title}</Link>)}
        </nav>

        {(!documentId || query) ? <section aria-label="帮助文档列表">
          <div className="help-list-heading"><h3>{query ? '搜索结果' : catalog.categories.find(item => item.id === category)?.title || '选择你要了解的内容'}</h3>
            <span role="status">{results.length} 篇文档</span></div>
          {!query && !category && <Link className="help-start" to="/tools/help/manual-01">
            <div><strong>第一次使用创剧？从操作手册开始</strong><p>按创作流程阅读，配合截图一步步完成你的作品。</p></div><ArrowRight size={20} />
          </Link>}
          {results.length === 0 && <div className="help-empty">没有找到相关文档。可以缩短关键词，或返回全部文档。</div>}
          <div className="help-grid">{results.map(item => <Link key={item.id} className="help-card" to={`/tools/help/${item.id}`}>
            <span>{catalog.categories.find(group => group.id === item.category)?.title}</span>
            <h3>{item.title}</h3><p>{item.summary}</p><div>阅读文档 <ArrowRight size={14} /></div>
          </Link>)}</div>
        </section> : !document ? <div className="help-empty" role="status">未找到这篇文档。<Link to="/tools/help">返回文档中心</Link></div> :
          <div className="help-reading">
            <article className="help-article">
              <Link className="help-back" to={`/tools/help?category=${document.category}`}><ArrowLeft size={14} /> 返回分类</Link>
              <h1 id={helpHeadingId(document.title)}>{document.title}</h1>
              <div className="help-meta"><span>{document.source}</span><button type="button" onClick={copyLink}>
                {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制链接' : '复制文档链接'}</button></div>
              {copyError && <p role="status">未能复制，请从浏览器地址栏复制当前链接。</p>}
              <p className="help-version-note">文档反映其来源版本。托管版与开源自部署版的功能、模型和配置可能不同，请以当前界面和已启用能力为准。</p>
              <details className="help-mobile-toc"><summary>本文目录</summary><nav>{headings.map(item =>
                <a key={item.id} href={`#${item.id}`}>{item.title}</a>)}</nav></details>
              <HelpMarkdown key={document.id} body={document.body} />
              {document.sourceUrl && <a className="help-source" href={safeHelpUrl(document.sourceUrl)} target="_blank" rel="noopener noreferrer">查看开源原文 <ExternalLink size={14} /></a>}
              <nav className="help-pagination" aria-label="文档翻页">
                {previous ? <Link to={`/tools/help/${previous.id}`}><small>上一篇</small>{previous.title}</Link> : <span />}
                {next && <Link to={`/tools/help/${next.id}`}><small>下一篇</small>{next.title}</Link>}
              </nav>
            </article>
            <aside className="help-toc"><h3>本文目录</h3><nav aria-label="本文目录">{headings.map(item =>
              <a key={item.id} href={`#${item.id}`} className={item.level > 2 ? 'nested' : ''}>{item.title}</a>)}</nav></aside>
          </div>}
        <footer className="help-footer">收录操作手册（2026-09-15）及 SceneGo 开源文档 · 整理日期 {catalog.updatedAt}</footer>
      </>}
    </div>
  </div>;
};

export default HelpCenterPage;
