








import React, {
  createContext, useContext, useEffect, useState, useCallback, useMemo,
} from 'react';
import type { Organization } from '../services/organizationService';
import { isAdminPath } from '../admin/adminRoute';

export type WorkspaceId = 'personal' | string;

interface WorkspaceContextValue {
  currentWorkspace: WorkspaceId;

  currentName: string;

  isOrgWorkspace: boolean;

  organizations: Organization[];

  setWorkspace: (ws: WorkspaceId) => void;

  refreshOrganizations: () => Promise<void>;

  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const STORAGE_KEY = 'current_workspace';

function readSavedWorkspace(): WorkspaceId {
  try {
    if (typeof window === 'undefined') return 'personal';
    return (sessionStorage.getItem(STORAGE_KEY) as WorkspaceId) || 'personal';
  } catch {
    return 'personal';
  }
}

function saveWorkspace(ws: WorkspaceId) {
  try {
    sessionStorage.setItem(STORAGE_KEY, ws);
  } catch {}
}


export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceId>(readSavedWorkspace);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshOrganizations = useCallback(async () => {

    try {
      if (
        typeof window !== 'undefined'
        && (isAdminPath(window.location.pathname) || window.location.pathname.startsWith('/share/final/') || window.location.pathname.replace(/\/$/, '') === '/updates')
      ) {
        return;
      }
    } catch {}
    setLoading(true);
    try {
      const { listMyOrganizations } = await import('../services/organizationService');
      const r = await listMyOrganizations();
      setOrganizations(r.organizations || []);


      const saved = readSavedWorkspace();
      if (saved !== 'personal') {
        const stillMember = (r.organizations || []).some(o => o.org_id === saved);
        if (!stillMember) {
          saveWorkspace('personal');
          setCurrentWorkspace('personal');
        }
      }
    } catch (e) {
      console.warn('refreshOrganizations failed:', e);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshOrganizations(); }, [refreshOrganizations]);

  const setWorkspace = useCallback((ws: WorkspaceId) => {
    saveWorkspace(ws);
    setCurrentWorkspace(ws);
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const isOrg = currentWorkspace !== 'personal';
    const org = organizations.find(o => o.org_id === currentWorkspace);
    return {
      currentWorkspace,
      currentName: isOrg ? (org?.name || currentWorkspace) : '个人空间',
      isOrgWorkspace: isOrg,
      organizations,
      setWorkspace,
      refreshOrganizations,
      loading,
    };
  }, [currentWorkspace, organizations, setWorkspace, refreshOrganizations, loading]);

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
};


export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {

    return {
      currentWorkspace: 'personal',
      currentName: '个人空间',
      isOrgWorkspace: false,
      organizations: [],
      setWorkspace: () => {},
      refreshOrganizations: async () => {},
      loading: false,
    };
  }
  return ctx;
}






export function useCurrentOrgId(): string | undefined {
  const ws = useWorkspace();
  return ws.isOrgWorkspace ? ws.currentWorkspace : undefined;
}
