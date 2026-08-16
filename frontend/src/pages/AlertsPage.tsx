import { Bell } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function AlertsPage() {
  return (
    <PlaceholderPage
      title="Alerts"
      description="Security alerts generated from AI detection events."
      review={1}
      icon={<Bell className="h-6 w-6" />}
      plannedFeatures={[
        'Weapon-detected alerts with severity',
        'Alert acknowledgement & resolution workflow',
        'Snapshot evidence per alert',
        'Unknown-person alerts (expanded in Review 2)',
      ]}
    />
  );
}
