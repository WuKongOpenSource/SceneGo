import React from 'react';
import { PlatformFooter } from './PlatformFooter';

export function PlatformShell({ children, showFooter = false }: React.PropsWithChildren<{ showFooter?: boolean }>) {
  return (
    <div className={`platform-shell${showFooter ? '' : ' platform-shell-workspace'}`}>
      <div className="platform-content">{children}</div>
      {showFooter && <PlatformFooter />}
    </div>
  );
}
