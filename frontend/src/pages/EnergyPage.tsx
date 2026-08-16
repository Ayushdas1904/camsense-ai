import { Zap } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function EnergyPage() {
  return (
    <PlaceholderPage
      title="Occupancy & Energy"
      description="Occupancy-driven energy optimization."
      review={3}
      icon={<Zap className="h-6 w-6" />}
      plannedFeatures={[
        'Room occupancy monitoring from detections',
        'Occupancy-based device automation (simulated)',
        'Energy consumed vs saved tracking',
        'Capacity threshold alerts',
      ]}
    />
  );
}
