









import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Coins, Image as ImageIcon, BarChart3, Settings,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { ADMIN_MENU, isToActive, MenuSection, MenuItem } from './adminMenu';
import { BrandLogo } from '../components/BrandLogo';
import { getAdminRole } from '@runtime/adminAuth';
import { adminPath } from './adminRoute';

const ICONS: Record<string, React.FC<{ className?: string }>> = {
  LayoutDashboard, Users, Coins, ImageIcon, BarChart3, Settings,
};

export const AdminSidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const isSuperAdmin = getAdminRole() === 'super_admin';
  const visibleMenu = useMemo(
    () => isSuperAdmin ? ADMIN_MENU : ADMIN_MENU.filter(section => section.id !== 'settings'),
    [isSuperAdmin],
  );


  const active = useMemo(() => {
    const currentItem = new URLSearchParams(search).get('item');
    if (pathname === adminPath('settings') && currentItem === 'legacy-apiconfig') {
      return { sectionId: 'settings', itemId: 'apiconfig', leafId: undefined as string | undefined };
    }

    for (const sec of visibleMenu) {
      for (const item of sec.children) {
        if (item.to && isToActive(item.to, pathname, search)) {
          return { sectionId: sec.id, itemId: item.id, leafId: undefined as string | undefined };
        }
        for (const leaf of item.children ?? []) {
          if (isToActive(leaf.to, pathname, search)) {
            return { sectionId: sec.id, itemId: item.id, leafId: leaf.id };
          }
        }
      }
    }
    return { sectionId: 'overview', itemId: 'dashboard', leafId: undefined };
  }, [pathname, search, visibleMenu]);


  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set([active.sectionId]));
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set([active.itemId]));

  useEffect(() => {
    setOpenSections(prev => new Set(prev).add(active.sectionId));
    setOpenItems(prev => new Set(prev).add(active.itemId));
  }, [active.sectionId, active.itemId]);

  const toggleSection = (id: string) =>
    setOpenSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleItem = (id: string) =>
    setOpenItems(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <aside className="w-60 shrink-0 bg-n900 flex flex-col min-h-0 text-n90">
      {/* header cell */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-n600 min-w-0">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-n0/95 p-1">
          <BrandLogo variant="mark" className="h-6 w-6" />
        </span>
        <div className="leading-tight min-w-0">
          <div className="text-sm font-bold tracking-tight text-n0 font-display">系统管理后台</div>
          <div className="text-[10px] uppercase tracking-widest text-n200"
              style={{ fontFamily: 'var(--font-mono)' }}>Admin Console</div>
        </div>
      </div>


      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {visibleMenu.map((sec: MenuSection) => {
          const Icon = ICONS[sec.icon] ?? Settings;
          const open = openSections.has(sec.id);
          return (
            <div key={sec.id} className="px-2">

              <button
                onClick={() => toggleSection(sec.id)}
                className={`w-full min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                  active.sectionId === sec.id ? 'text-n0' : 'text-n90 hover:text-n0 hover:bg-n700'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="flex-1 min-w-0 text-left truncate">{sec.label}</span>
                {open ? <ChevronDown className="w-3.5 h-3.5 text-n100" /> : <ChevronRight className="w-3.5 h-3.5 text-n100" />}
              </button>


              {open && (
                <div className="mt-0.5 mb-1 ml-3 pl-3 border-l border-n600 space-y-0.5">
                  {sec.children.map((item: MenuItem) => {
                    const hasLeaves = !!item.children?.length;
                    const itemActive = active.itemId === item.id && !active.leafId;
                    const itemOpen = openItems.has(item.id);
                    return (
                      <div key={item.id}>
                        <button
                          onClick={() => hasLeaves ? toggleItem(item.id) : item.to && navigate(item.to)}
                          className={`w-full min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                            itemActive
                              ? 'bg-primary text-n0 font-medium'
                              : 'text-n90 hover:text-n0 hover:bg-n700'
                          }`}
                        >
                          <span className="flex-1 min-w-0 text-left truncate">{item.label}</span>
                          {hasLeaves && (itemOpen
                            ? <ChevronDown className="w-3 h-3 text-n100" />
                            : <ChevronRight className="w-3 h-3 text-n100" />)}
                        </button>


                        {hasLeaves && itemOpen && (
                          <div className="mt-0.5 ml-2 pl-2.5 border-l border-n600 space-y-0.5">
                            {item.children!.map(leaf => {
                              const leafActive = active.leafId === leaf.id;
                              return (
                                <button
                                  key={leaf.id}
                                  onClick={() => navigate(leaf.to)}
                                  className={`w-full min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                                    leafActive
                                      ? 'bg-primary text-n0 font-medium'
                                      : 'text-n90 hover:text-n0 hover:bg-n700'
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${leafActive ? 'bg-n0' : 'bg-n400'}`} />
                                  <span className="flex-1 min-w-0 text-left truncate">{leaf.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
