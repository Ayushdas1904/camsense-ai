import { Cctv } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function CamerasPage() {
  return (
    <PlaceholderPage
      title="Cameras"
      description="Register and manage camera sources."
      review={1}
      icon={<Cctv className="h-6 w-6" />}
      plannedFeatures={[
        'Add / edit / remove cameras',
        'DEMO mode (sample video) and REAL mode (RTSP/IP)',
        'Per-camera status and AI toggle',
        'Connection health monitoring',
      ]}
    />
  );
}
