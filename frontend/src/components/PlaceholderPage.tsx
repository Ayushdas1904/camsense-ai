import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { PageHeader, Card, CardBody, Badge } from '@/components/ui';

/**
 * Future-ready page scaffold. Renders a real, honest placeholder for sections
 * whose features arrive in a later review — NOT fake data or non-functional
 * widgets. It states plainly what the section will do and when.
 */
export function PlaceholderPage({
  title,
  description,
  review,
  plannedFeatures,
  icon,
}: {
  title: string;
  description: string;
  review: 1 | 2 | 3;
  plannedFeatures: string[];
  icon?: ReactNode;
}) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        action={<Badge tone="info">Planned · Review {review}</Badge>}
      />
      <Card>
        <CardBody>
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="rounded-full bg-raised p-3 text-content-muted">
              {icon ?? <Construction className="h-6 w-6" />}
            </div>
            <div className="max-w-md">
              <p className="text-sm font-medium text-content">
                This section is part of the planned architecture.
              </p>
              <p className="mt-1 text-sm text-content-muted">
                It is intentionally not implemented in the foundation phase. The
                features below will be built in Review {review}.
              </p>
            </div>
            <ul className="mt-2 grid w-full max-w-md gap-2 text-left">
              {plannedFeatures.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
