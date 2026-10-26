import { Outlet } from 'react-router-dom';
import { MobileNav, Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

/**
 * Main authenticated shell: fixed sidebar + topbar, scrollable content region.
 * All protected pages render into <Outlet /> so they share one consistent frame.
 *
 * Navigation is responsive: the sidebar is shown from `md` upwards and the
 * MobileNav strip below it. Exactly one of the two is ever visible, and both
 * render from the same navItems list, so there is no duplicate nav entry.
 */
export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-base">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <MobileNav />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
