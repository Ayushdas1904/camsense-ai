import { NavLink } from 'react-router-dom';
import { navItems } from '@/routes/navigation';
import { cn } from '@/utils/cn';

/**
 * Primary navigation sidebar. Renders from the shared navItems config so it
 * always stays in sync with the router. Each item links to its section; future
 * sections render future-ready placeholder pages until their review lands.
 */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <img src="/camsense.svg" alt="" className="h-7 w-7" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-content">CamSense AI</p>
          <p className="text-[10px] uppercase tracking-wider text-content-faint">
            CCTV Intelligence
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-brand/10 text-brand'
                  : 'text-content-muted hover:bg-raised hover:text-content'
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-3">
        <p className="text-[10px] text-content-faint">v0.1.0 · Foundation</p>
      </div>
    </aside>
  );
}
