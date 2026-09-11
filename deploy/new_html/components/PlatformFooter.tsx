import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { History } from 'lucide-react';
import release from '../../static/platform-release.json';
import '../styles/platform-release.css';

const changeLabels: Record<string, string> = { new: '新增', improvement: '优化', fix: '修复' };

export function ReleaseNotesContent() {
  return (
    <div className="platform-release-content">
      <div className="platform-release-overview">
        <span className="platform-release-version">v{release.version}</span>
        <p>最近一周 · {release.period.from} — {release.period.to}</p>
        <small>按代码更新日期整理，未为历史更新补编版本号。</small>
      </div>
      <div className="platform-release-timeline">
        {release.records.map(record => (
          <article key={record.date} className="platform-release-entry">
            <time dateTime={record.date}>{record.date}</time>
            <h3>{record.title}</h3>
            <ul>
              {record.changes.map(change => (
                <li key={change.text}>
                  <span className={`platform-release-tag platform-release-tag-${change.kind}`}>{changeLabels[change.kind]}</span>
                  <span>{change.text}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PlatformFooter({ placement = 'footer', collapsed = false }: {
  placement?: 'footer' | 'sidebar';
  collapsed?: boolean;
} = {}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const sidebar = placement === 'sidebar';
  const openNotes = () => {
    if (typeof dialog.current?.showModal === 'function') dialog.current.showModal();
    else window.location.assign('/updates');
  };

  return (
    <>
      <footer
        className={sidebar ? 'platform-sidebar-release' : 'platform-footer'}
        data-collapsed={sidebar && collapsed ? 'true' : undefined}
        aria-label="平台版本与更新记录"
      >
        {sidebar && collapsed ? (
          <button type="button" onClick={openNotes} aria-haspopup="dialog"
            aria-label={`版本与更新记录：v${release.version}`} title={`v${release.version} · 更新记录`}>
            <History size={16} aria-hidden="true" />
          </button>
        ) : (
          <>
            {!sidebar && <span>Ovideo</span>}
            <span className="platform-footer-version" aria-label={`平台版本 ${release.version}`}>v{release.version}</span>
            {!sidebar && <span aria-hidden="true" className="platform-footer-divider" />}
            <button type="button" onClick={openNotes} aria-haspopup="dialog">更新记录 <span aria-hidden="true">↗</span></button>
          </>
        )}
      </footer>
      {createPortal(<dialog
        ref={dialog}
        className="platform-release-dialog"
        aria-labelledby={titleId}
        onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      >
        <div className="platform-release-panel">
          <header className="platform-release-header">
            <div><span className="platform-release-eyebrow">WHAT’S NEW</span><h2 id={titleId}>更新记录</h2></div>
            <button type="button" className="platform-release-close" onClick={() => dialog.current?.close()} aria-label="关闭更新记录" autoFocus>×</button>
          </header>
          <ReleaseNotesContent />
          <div className="platform-release-bottom">持续打磨，让每一步创作更顺手。</div>
        </div>
      </dialog>, document.body)}
    </>
  );
}
