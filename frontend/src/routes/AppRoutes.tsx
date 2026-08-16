import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from '@/layouts/AppLayout';

import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LiveMonitoringPage } from '@/pages/LiveMonitoringPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { CamerasPage } from '@/pages/CamerasPage';
import { PeoplePage } from '@/pages/PeoplePage';
import { AttendancePage } from '@/pages/AttendancePage';
import { EnergyPage } from '@/pages/EnergyPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Application route table. Public routes (login) sit outside the guard; every
 * feature route is nested under ProtectedRoute + AppLayout so they share the
 * shell and require authentication.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="live" element={<LiveMonitoringPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="cameras" element={<CamerasPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="energy" element={<EnergyPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
