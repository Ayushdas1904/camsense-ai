import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, ShieldAlert, Video, Gauge, Users, Cctv } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  Badge,
  Select,
  StatusIndicator,
  LoadingState,
  ErrorState,
} from '@/components/ui';
import { cameraService } from '@/services/cameraService';
import { dashboardService } from '@/services/dashboardService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { SocketEvents } from '@/services/socket';
import { formatTime } from '@/utils/format';
import type { AiStatus, Camera, DetectionEventPayload, StreamStats, ViewStatus } from '@/types';

/**
 * Live Monitoring — the Review 1 centerpiece.
 *
 * The annotated video (with real detection boxes drawn by the AI service) is
 * proxied through the backend and shown in an <img>. Live stats are polled
 * while monitoring; recent detections stream in over Socket.IO.
 */
export function LiveMonitoringPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [selectedId, setSelectedId] = useState<string>('');

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamSrc, setStreamSrc] = useState<string>('');

  const [stats, setStats] = useState<StreamStats | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [recent, setRecent] = useState<DetectionEventPayload[]>([]);

  const statsTimer = useRef<number | null>(null);

  const selected = cameras.find((c) => c._id === selectedId) || null;

  // Load cameras + AI status once.
  useEffect(() => {
    (async () => {
      try {
        const [cams, statsData] = await Promise.all([
          cameraService.list(),
          dashboardService.stats().catch(() => null),
        ]);
        setCameras(cams);
        if (statsData) setAi(statsData.ai);
        if (cams.length) setSelectedId(cams[0]._id);
        setStatus(cams.length ? 'success' : 'empty');
      } catch {
        setStatus('error');
      }
    })();
  }, []);

  const stopStatsPolling = useCallback(() => {
    if (statsTimer.current) {
      window.clearInterval(statsTimer.current);
      statsTimer.current = null;
    }
  }, []);

  // Poll live stats while monitoring.
  useEffect(() => {
    if (!running || !selected) return;
    const poll = async () => {
      try {
        setStats(await cameraService.stats(selected._id));
      } catch {
        /* transient — keep last stats */
      }
    };
    poll();
    statsTimer.current = window.setInterval(poll, 1500);
    return stopStatsPolling;
  }, [running, selected, stopStatsPolling]);

  // Live detection feed for the selected camera.
  useSocketEvent<DetectionEventPayload>(SocketEvents.DETECTION_NEW, (payload) => {
    if (!selected || payload.cameraId !== selected.cameraId) return;
    setRecent((prev) => [payload, ...prev].slice(0, 8));
  });

  async function handleStart() {
    if (!selected) return;
    setStarting(true);
    setStreamError(null);
    try {
      await cameraService.startMonitoring(selected._id);
      setStreamSrc(cameraService.streamUrl(selected._id));
      setRunning(true);
    } catch (err) {
      setStreamError((err as { message?: string }).message ?? 'AI detection is temporarily unavailable.');
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!selected) return;
    await cameraService.stopMonitoring(selected._id).catch(() => {});
    setRunning(false);
    setStreamSrc('');
    setStats(null);
    stopStatsPolling();
  }

  // Stop stream when switching cameras.
  function handleSelect(id: string) {
    if (running) handleStop();
    setSelectedId(id);
    setRecent([]);
  }

  async function handleDemoWeapon() {
    if (!selected) return;
    await cameraService.triggerDemoWeapon(selected._id).catch(() => {});
  }

  if (status === 'loading') return <LoadingState message="Loading cameras…" />;
  if (status === 'error') return <ErrorState message="Unable to load monitoring." />;
  if (status === 'empty') {
    return (
      <div>
        <PageHeader title="Live Monitoring" description="Real-time camera feeds with AI detection." />
        <Card>
          <CardBody>
            <div className="py-10 text-center text-sm text-content-muted">
              No cameras registered yet. Add one on the Cameras page to begin.
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const weaponActive = ai?.detectors?.find((d) => d.key === 'weapon')?.status === 'active';

  return (
    <div>
      <PageHeader
        title="Live Monitoring"
        description="Select a camera and start the AI-processed stream."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main video area */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="w-64">
                  <Select
                    value={selectedId}
                    onChange={(e) => handleSelect(e.target.value)}
                    options={cameras.map((c) => ({ value: c._id, label: `${c.name} (${c.cameraId})` }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {selected?.mode === 'demo' && <Badge tone="info">DEMO MODE</Badge>}
                  {running ? (
                    <Button variant="danger" size="sm" leftIcon={<Square className="h-4 w-4" />} onClick={handleStop}>
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      leftIcon={<Play className="h-4 w-4" />}
                      loading={starting}
                      onClick={handleStart}
                    >
                      Start Stream
                    </Button>
                  )}
                </div>
              </div>

              {/* Video canvas */}
              <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
                {running && streamSrc && !streamError ? (
                  <>
                    <img
                      src={streamSrc}
                      alt="Live camera feed"
                      className="h-full w-full object-contain"
                      onError={() =>
                        setStreamError('Camera connection unavailable. Retry connection.')
                      }
                    />
                    <div className="absolute left-3 top-3 flex items-center gap-2">
                      <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-critical" /> LIVE
                      </span>
                      <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-info">
                        AI ACTIVE
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-content-muted">
                    {streamError ? (
                      <ErrorState message={streamError} onRetry={handleStart} />
                    ) : (
                      <>
                        <Video className="h-8 w-8" />
                        <p className="text-sm">Stream stopped. Press “Start Stream” to begin AI monitoring.</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {running && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-content-faint">
                    Detection overlays are rendered from real model coordinates.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<ShieldAlert className="h-4 w-4" />}
                    onClick={handleDemoWeapon}
                    title="Injects a clearly-labelled DEMO weapon detection to demonstrate the alert pipeline"
                  >
                    Trigger demo weapon (DEMO)
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Camera" />
            <CardBody className="space-y-3 text-sm">
              <Row label="Name" value={selected?.name ?? '—'} />
              <Row label="Location" value={selected?.location || '—'} />
              <div className="flex items-center justify-between">
                <span className="text-content-muted">Status</span>
                <StatusIndicator status={running ? 'online' : 'offline'} label={running ? 'Online' : 'Offline'} pulse={running} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="AI System" />
            <CardBody className="space-y-2.5 text-sm">
              <DetectorRow label="Human Detection" active={ai?.detectors?.find((d) => d.key === 'human')?.status === 'active'} />
              <DetectorRow label="Weapon Detection" active={weaponActive} />
              <DetectorRow label="Video Processing" active={running} activeLabel="Active" idleLabel="Idle" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Processing" />
            <CardBody className="grid grid-cols-2 gap-3 text-sm">
              <Metric icon={<Gauge className="h-4 w-4" />} label="FPS" value={running ? String(stats?.fps ?? '—') : '—'} />
              <Metric icon={<Gauge className="h-4 w-4" />} label="Inference" value={running && stats ? `${stats.inference_ms}ms` : '—'} />
              <Metric icon={<Users className="h-4 w-4" />} label="People" value={running ? String(stats?.people ?? 0) : '—'} />
              <Metric icon={<ShieldAlert className="h-4 w-4" />} label="Weapons" value={running ? String(stats?.weapons ?? 0) : '—'} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent Detections" />
            <CardBody>
              {recent.length === 0 ? (
                <p className="py-4 text-center text-xs text-content-faint">
                  {running ? 'Watching for detections…' : 'Start the stream to see detections.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {recent.map((d, i) => (
                    <li key={`${d.id}-${i}`} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        <Cctv className="h-3.5 w-3.5 text-content-faint" />
                        <span className="capitalize text-content">{d.class} detected</span>
                        {d.source === 'demo' && <Badge tone="info">DEMO</Badge>}
                      </span>
                      <span className="text-content-faint">{formatTime(d.timestamp)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-content-muted">{label}</span>
      <span className="text-content">{value}</span>
    </div>
  );
}

function DetectorRow({
  label,
  active,
  activeLabel = 'Active',
  idleLabel = 'Unavailable',
}: {
  label: string;
  active?: boolean;
  activeLabel?: string;
  idleLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-content-muted">{label}</span>
      <StatusIndicator status={active ? 'ai' : 'offline'} label={active ? activeLabel : idleLabel} />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="flex items-center gap-1.5 text-xs text-content-muted">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-content">{value}</p>
    </div>
  );
}
