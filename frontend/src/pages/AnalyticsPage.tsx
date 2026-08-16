import { BarChart3 } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function AnalyticsPage() {
  return (
    <PlaceholderPage
      title="Analytics"
      description="Trends across detections, alerts, attendance and energy."
      review={3}
      icon={<BarChart3 className="h-6 w-6" />}
      plannedFeatures={[
        'Detection & alert trends over time (Recharts)',
        'Attendance analytics',
        'Occupancy heat patterns',
        'Energy savings reports',
      ]}
    />
  );
}
