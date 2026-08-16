import { MonitorPlay } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function LiveMonitoringPage() {
  return (
    <PlaceholderPage
      title="Live Monitoring"
      description="Real-time camera feeds with AI detection overlays."
      review={1}
      icon={<MonitorPlay className="h-6 w-6" />}
      plannedFeatures={[
        'Multi-camera live grid (DEMO video + RTSP/IP in REAL mode)',
        'Human detection overlays from the AI pipeline',
        'Weapon detection overlays',
        'Per-camera AI enable/disable',
      ]}
    />
  );
}
