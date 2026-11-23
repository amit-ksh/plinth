import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import CheckListIcon from '@hugeicons/core-free-icons/CheckListIcon';
import ConnectIcon from '@hugeicons/core-free-icons/ConnectIcon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import Download01Icon from '@hugeicons/core-free-icons/Download01Icon';
import DropletIcon from '@hugeicons/core-free-icons/DropletIcon';
import FileExportIcon from '@hugeicons/core-free-icons/FileExportIcon';
import Home01Icon from '@hugeicons/core-free-icons/Home01Icon';
import Menu01Icon from '@hugeicons/core-free-icons/Menu01Icon';
import PackageIcon from '@hugeicons/core-free-icons/PackageIcon';
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
import SidebarLeftIcon from '@hugeicons/core-free-icons/SidebarLeftIcon';
import Store01Icon from '@hugeicons/core-free-icons/Store01Icon';
import Upload01Icon from '@hugeicons/core-free-icons/Upload01Icon';
import type { IconSvgElement } from '@hugeicons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PRODUCT_NAME } from '../../../packages/core/src/product.ts';
import { productHref, useApp, type Route } from './context.ts';
import { call, explainError } from './engine.ts';
import { download, Icon } from './ui.tsx';

const SAVED = {
  device: 'Saved on this device',
  memory: 'Demo, not saved',
  locked: 'Not saving',
  unavailable: 'Not saving',
  'read-only': 'Read only',
} as const;

/** A plinth: the stepped base a column stands on, the floor a price should never go under. */
function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <rect x="7" y="2.5" width="6" height="7" rx="1" />
        <rect x="4.5" y="10.5" width="11" height="2.75" rx="1" />
        <rect x="2.5" y="14.250" width="15" height="3.250" rx="1" />
      </svg>
    </span>
  );
}

function NavLink({ href, icon, label, active, count }: {
  href: string;
  icon: IconSvgElement;
  label: string;
  active: boolean;
  count?: number;
}) {
  return (
    <a href={href} aria-current={active ? 'page' : undefined}>
      <Icon icon={icon} size={20} />
      <span className="grow">{label}</span>
      {!!count && <span className="count">{count}</span>}
    </a>
  );
}

function StoreMenu() {
  const { data, notify } = useApp();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const el = menu.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        el.open = false;
        el.querySelector('summary')?.focus();
      } else if (!el.contains(event.target as Node)) el.open = false;
    };
    addEventListener('keydown', close);
    addEventListener('pointerdown', close);
    addEventListener('focusin', close);
    return () => {
      removeEventListener('keydown', close);
      removeEventListener('pointerdown', close);
      removeEventListener('focusin', close);
    };
  }, []);

  const save = async (kind: 'backup' | 'report') => {
    menu.current!.open = false;
    menu.current!.querySelector('summary')?.focus();
    if (kind === 'report') notify('Preparing your report…');
    try {
      const text = await call(kind);
      if (kind === 'backup') download('audit-backup.json', text, 'application/json');
      else download('discount-audit.html', text, 'text/html');
      notify(kind === 'backup' ? 'Backup downloaded' : 'Report downloaded');
    } catch (error) {
      notify(explainError(error).join('. '));
    }
  };

  const closeMenu = () => {
    menu.current!.open = false;
  };

  return (
    <details className="store-menu" ref={menu}>
      <summary>
        <span>{data.app.settings.storeName}</span>
        <Icon icon={ArrowDown01Icon} size={16} strong />
      </summary>
      <div className="menu">
        <button onClick={() => save('report')}><Icon icon={FileExportIcon} />Download report</button>
        <button onClick={() => save('backup')}><Icon icon={Download01Icon} />Back up</button>
        <a href="#import" onClick={closeMenu}><Icon icon={Upload01Icon} />Import or restore</a>
      </div>
    </details>
  );
}

export function Shell({ route, toast, dismissToast, children }: {
  route: Route;
  toast: { message: string; undo: boolean } | null;
  dismissToast: () => void;
  children: ReactNode;
}) {
  const { data, change, query, setQuery } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Keep the menu open while someone is typing in its search box.
    if (document.activeElement?.id !== 'search') setMenuOpen(false);
  }, [route]);

  const { view } = route;
  const { settings, checklist, sample } = data.app;
  const toDo = checklist.filter((item) => !item.done).length;
  const attention = data.audit.variants
    .filter((v) => v.state === 'leak' || v.state === 'unknown')
    .sort((a, b) => Number(a.state !== 'leak') - Number(b.state !== 'leak'))
    .slice(0, 4);
  const onHome = !['audit', 'product', 'products', 'discounts', 'checklist', 'import', 'settings', 'agent'].includes(view);
  const onAudit = view === 'audit' || view === 'product';

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <div className="frame">
        <div className="guides" aria-hidden="true" />
        <div className={`window${collapsed ? ' collapsed' : ''}`}>
          <aside className="sidebar" aria-label="Sidebar">
            <div className="brand">
              <a className="brand-name" href="#home" aria-label={`${PRODUCT_NAME} home`}>
                <Mark />
                <span className="name">{PRODUCT_NAME}</span>
              </a>
              <button
                className="btn ghost round collapse"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)}
              >
                <Icon icon={SidebarLeftIcon} size={20} />
              </button>
              <button
                className="btn ghost round menu-toggle"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                aria-controls="side-body"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <Icon icon={menuOpen ? Cancel01Icon : Menu01Icon} size={20} />
              </button>
            </div>

            <div className={`side-body${menuOpen ? ' open' : ''}`} id="side-body">
              <div className="search">
                <label className="sr" htmlFor="search">Search products</label>
                <Icon icon={Search01Icon} />
                <input id="search" name="search" type="search" autoComplete="off" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>

              <div className="side-scroll">
                <nav className="nav" aria-label="Main">
                  <span className="nav-label">Workspace</span>
                  <NavLink href="#home" icon={Home01Icon} label="Home" active={onHome} />
                  <NavLink href="#audit" icon={DropletIcon} label="Audit" active={onAudit} count={data.audit.counts.leak} />
                  <NavLink href="#products" icon={PackageIcon} label="Products" active={view === 'products'} />
                  <NavLink href="#discounts" icon={DiscountTag01Icon} label="Discounts" active={view === 'discounts'} />
                  <NavLink href="#checklist" icon={CheckListIcon} label="Checklist" active={view === 'checklist'} count={toDo} />
                  <NavLink href="#import" icon={Upload01Icon} label="Import" active={view === 'import'} />
                  <NavLink href="#settings" icon={Settings01Icon} label="Settings" active={view === 'settings'} />
                </nav>
                {attention.length > 0 && (
                  <nav className="nav recent" aria-label="Needs attention">
                    <span className="nav-label">Needs attention</span>
                    {attention.map((v) => (
                      <a key={v.id} href={productHref(v.id)}>{v.title}</a>
                    ))}
                  </nav>
                )}
              </div>

              <a className="store-card" href="#settings">
                <span className="store-avatar"><Icon icon={Store01Icon} /></span>
                <span className="who">
                  <strong>{settings.storeName}</strong>
                  <span className="caption muted">{sample ? 'Sample data' : SAVED[data.saved]}</span>
                </span>
              </a>
            </div>
          </aside>

          <div className="pane">
            <header className="topbar">
              <StoreMenu />
              <nav className="switch" aria-label="Mode">
                <a href="#home" aria-current={onHome ? 'page' : undefined}>Check</a>
                <a href="#audit" aria-current={onAudit ? 'page' : undefined}>Audit</a>
              </nav>
              <a className="btn ghost round end" href="#agent" aria-label="Connect an AI agent">
                <Icon icon={ConnectIcon} size={20} />
              </a>
            </header>

            <div className="main-panel">
              <main id="main" tabIndex={-1}>
                {(data.saved === 'locked' || data.saved === 'unavailable') && (
                  <div className="banner">
                    <p>
                      {data.saved === 'locked'
                        ? 'Your audit is open in another tab. This is the sample, and changes here won’t be saved.'
                        : 'This browser can’t save audits. Back up before you close the tab.'}
                    </p>
                    {data.saved === 'locked' && <button className="btn" onClick={() => location.reload()}>Try again</button>}
                  </div>
                )}
                {children}
              </main>
              <div className="toast-slot" role="status">
                {toast && (
                  <div className="toast">
                    <p>{toast.message}</p>
                    <span className="buttons">
                      {toast.undo && (
                        <button className="btn" onClick={() => change(() => call('undo'), 'Change undone')}>Undo</button>
                      )}
                      <button className="btn ghost round" aria-label="Dismiss message" onClick={() => { dismissToast(); document.getElementById('main')?.focus(); }}>
                        <Icon icon={Cancel01Icon} />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
