import { NavLink } from 'react-router-dom';
import { navItems } from '@/routes/navigation';
import { cn } from '@/utils/cn';

/**
 * Primary navigation sidebar. Renders from the shared navItems config so it
 * always stays in sync with the router — there is exactly one list of
 * sections in the app, which is why the desktop sidebar and the mobile strip
 * below can never disagree or duplicate an entry.
 *
 * Hidden below the `md` breakpoint; MobileNav takes over there.
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
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
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
        <p className="text-[10px] text-content-faint">
          v1.0.0 · Detection · Identity · Automation
        </p>
      </div>
    </aside>
  );
}

/**
 * Navigation for narrow viewports.
 *
 * The desktop sidebar is `hidden md:flex`, which left the app with NO
 * navigation at all below 768px — every section was unreachable once the
 * window narrowed. This horizontally scrollable strip fixes that. It renders
 * from the SAME navItems list, so it is not a duplicate set of links to keep
 * in sync, and it is `md:hidden` so only one of the two is ever on screen.
 */
export function MobileNav() {
  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden"
      aria-label="Main navigation"
    >
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
              isActive
                ? 'bg-brand/10 text-brand'
                : 'text-content-muted hover:bg-raised hover:text-content'
            )
          }
        >
          <item.icon className="h-4 w-4" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
