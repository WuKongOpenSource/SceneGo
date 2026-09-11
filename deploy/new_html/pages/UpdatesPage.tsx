import React from 'react';
import { ReleaseNotesContent } from '../components/PlatformFooter';

export default function UpdatesPage() {
  return (
    <main className="platform-updates-page">
      <a href="/projects">← 返回创作平台</a>
      <section aria-labelledby="updates-page-title">
        <header className="platform-release-header">
          <div><span className="platform-release-eyebrow">WHAT’S NEW</span><h2 id="updates-page-title">更新记录</h2></div>
        </header>
        <ReleaseNotesContent />
      </section>
    </main>
  );
}
