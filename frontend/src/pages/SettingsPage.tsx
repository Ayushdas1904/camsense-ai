import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Button,
  StatusIndicator,
  LoadingState,
  ErrorState,
} from '@/components/ui';
import { useAppSelector } from '@/hooks/redux';
import { cameraService } from '@/services/cameraService';
import { dashboardService } from '@/services/dashboardService';
import type { AiStatus, Camera, ViewStatus } from '@/types';

/**
 * Settings — account profile and the real detection-mode picture.
 *
 * WHAT CHANGED HERE AND WHY: this panel previously rendered a hardcoded
 * `StatusIndicator label="DEMO"` next to the words "Switch between sample
 * video and live camera streams". Both were misleading. The indicator claimed
 * a mode regardless of what the AI service actually reported, and the copy
 * implied a switch that does not exist on this page — detection mode is a
 * per-camera setting, configured under Cameras.
 *
 * It now reports what is true: the mode the AI service itself reports, whether
 * that service is reachable at all, and the real DEMO/REAL split across the
 * configured cameras. There is no control here that does not work.
 */
export function SettingsPage() {
  const user = useAppSelector((s) => s.auth.user);

  const [ai, setAi] = useState<AiStatus | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    const [statsRes, camerasRes] = await Promise.allSettled([
      dashboardService.stats(),
      cameraService.list(),
    ]);
    if (statsRes.status === 'fulfilled') setAi(statsRes.value.ai);
    if (camerasRes.status === 'fulfilled') setCameras(camerasRes.value);
    setStatus(
      statsRes.status === 'rejected' && camerasRes.status === 'rejected' ? 'error' : 'success'
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const demoCameras = cameras.filter((camera) => camera.mode === 'demo').length;
  const realCameras = cameras.filter((camera) => camera.mode === 'real').length;

  return (
    <div>
      <PageHeader title="Settings" description="Account and system configuration." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" description="Your operator profile" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label="Name" value={user?.name ?? '—'} />
              <Row label="Email" value={user?.email ?? '—'} />
              <Row label="Role" value={<span className="capitalize">{user?.role ?? '—'}</span>} />
            </dl>
            {user?.role !== 'admin' && (
              <p className="mt-3 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
                Administrative actions — registering people, configuring rooms and devices,
                changing automation rules and switching a device — require the administrator role.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Detection Mode"
            description="Configured per camera, reported by the AI service"
            action={<Badge tone="info">Review 1</Badge>}
          />
          <CardBody>
            {status === 'loading' ? (
              <LoadingState message="Reading detection status…" />
            ) : status === 'error' ? (
              <ErrorState
                message="The detection status could not be read from the backend."
                onRetry={load}
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-content">AI service</p>
                    <p className="text-xs text-content-muted">
                      {ai?.reachable
                        ? ai.model_loaded
                          ? 'Reachable, detection model loaded.'
                          : 'Reachable, but NO detection model is loaded — no detections are produced.'
                        : 'Not reachable. Detection is unavailable; nothing is being fabricated in its place.'}
                    </p>
                  </div>
                  <StatusIndicator
                    status={ai?.reachable ? (ai.model_loaded ? 'ai' : 'warning') : 'error'}
                    label={
                      ai?.reachable ? (ai.model_loaded ? 'Active' : 'No model') : 'Unreachable'
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div>
                    <p className="text-sm text-content">Mode reported by the AI service</p>
                    <p className="text-xs text-content-muted">
                      Its own default processing mode, not a per-camera setting.
                    </p>
                  </div>
                  <Badge tone={ai?.mode === 'real' ? 'safe' : 'warning'}>
                    {ai?.mode ? ai.mode.toUpperCase() : 'UNKNOWN'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div>
                    <p className="text-sm text-content">Configured cameras</p>
                    <p className="text-xs text-content-muted">
                      {cameras.length === 0
                        ? 'No cameras are configured yet.'
                        : `${realCameras} real · ${demoCameras} demo (sample video).`}
                    </p>
                  </div>
                  <Link to="/cameras">
                    <Button variant="secondary" size="sm">
                      Cameras
                    </Button>
                  </Link>
                </div>

                {demoCameras > 0 && (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {demoCameras} camera(s) run in DEMO mode against sample video. Their
                    detections are labelled <strong>demo</strong> everywhere they appear and are
                    never presented as live-camera output.
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <dt className="text-content-muted">{label}</dt>
      <dd className="text-content">{value}</dd>
    </div>
  );
}
