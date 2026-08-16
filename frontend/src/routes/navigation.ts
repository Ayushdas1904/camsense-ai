import {
  LayoutDashboard,
  MonitorPlay,
  Bell,
  CalendarCheck,
  Users,
  Cctv,
  Zap,
  BarChart3,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Single source of truth for primary navigation. The sidebar renders from this
 * list and the router builds routes from it, so adding a section is a one-line
 * change here. `review` documents which phase brings each section to life.
 */
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  review: 1 | 2 | 3;
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, review: 1 },
  { label: 'Live Monitoring', path: '/live', icon: MonitorPlay, review: 1 },
  { label: 'Alerts', path: '/alerts', icon: Bell, review: 1 },
  { label: 'Cameras', path: '/cameras', icon: Cctv, review: 1 },
  { label: 'People', path: '/people', icon: Users, review: 2 },
  { label: 'Attendance', path: '/attendance', icon: CalendarCheck, review: 2 },
  { label: 'Occupancy & Energy', path: '/energy', icon: Zap, review: 3 },
  { label: 'Analytics', path: '/analytics', icon: BarChart3, review: 3 },
  { label: 'Settings', path: '/settings', icon: Settings, review: 1 },
];
