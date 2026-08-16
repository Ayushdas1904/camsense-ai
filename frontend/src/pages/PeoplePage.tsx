import { Users } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export function PeoplePage() {
  return (
    <PlaceholderPage
      title="People"
      description="Register individuals for face recognition and attendance."
      review={2}
      icon={<Users className="h-6 w-6" />}
      plannedFeatures={[
        'Person registration with photo',
        'Face embedding generation via the AI service',
        'Known vs unknown identity management',
        'Department & role assignment',
      ]}
    />
  );
}
