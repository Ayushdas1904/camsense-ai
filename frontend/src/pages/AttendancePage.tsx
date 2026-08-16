import { CalendarCheck } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function AttendancePage() {
  return (
    <PlaceholderPage
      title="Attendance"
      description="Automated attendance from face recognition."
      review={2}
      icon={<CalendarCheck className="h-6 w-6" />}
      plannedFeatures={[
        'Automatic marking on recognition',
        'Duplicate-attendance prevention (one record per person per day)',
        'Daily attendance register',
        'First-seen / last-seen timestamps',
      ]}
    />
  );
}
