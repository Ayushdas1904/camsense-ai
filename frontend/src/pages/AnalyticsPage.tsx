import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, TrendingUp, DoorOpen, Zap } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Select,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { energyService } from '@/services/energyService';
import { occupancyService } from '@/services/occupancyService';
import { formatDateTime } from '@/utils/format';
import { renderCount } from '@/utils/review3';
import type {
  EnergyByDevice,
  EnergyByRoom,
  EnergyTrend,
  OccupancyReading,
  Room,
  ViewStatus,
} from '@/types';

/**
 * ═══ ANALYTICS (Review 3) ═══
 *
 * Four charts, deliberately no more, each driven by one documented endpoint:
 *
 *   1. Energy consumed vs baseline, per day   GET /api/energy/trend
 *   2. Estimated energy by room               GET /api/energy/by-room
 *   3. Estimated energy by device             GET /api/energy/by-device
 *   4. Occupancy over time for one room       GET /api/occupancy/history
 *
 * ═══ WHAT IS NOT HERE, ON PURPOSE ═══
 *
 * No random series, no hardcoded "savings achieved" figure, and no chart that
 * renders an empty axis when there is no data. An empty axis is the dangerous
 * case: a flat line at zero looks like a measurement of zero consumption, when
 * the truth is that nothing has been recorded yet. So every chart below has
 * three states — error, insufficient-data (showing the backend's own
 * `requires` message), and data — and only the third one draws axes.
 *
 * The energy trend in particular reads the COMPLETED-DAY rollup, which is
 * never written for a day in progress. On a freshly started system it
 * legitimately returns `insufficientData: true`, and the right thing to render
 * is "come back after a full day", not a chart.
 *
 * Every energy figure is an ESTIMATE: a configured wattage multiplied by a
 * measured on-duration, quoted against the operator-set baseline that travels
 * inside each response. The baseline description is rendered under the trend
 * chart, where the comparison is actually being made.
 */

/** Chart colours, taken from the app's existing semantic palette. */
const COLOR = {
  consumed: '#38bdf8', // info
  baseline: '#94a3b8', // muted
  saved: '#22c55e', // safe
  occupancy: '#38bdf8',
};

export function AnalyticsPage() {
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [trend, setTrend] = useState<EnergyTrend | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [byRoom, setByRoom] = useState<EnergyByRoom | null>(null);
  const [byRoomError, setByRoomError] = useState<string | null>(null);
  const [byDevice, setByDevice] = useState<EnergyByDevice | null>(null);
  const [byDeviceError, setByDeviceError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [readings, setReadings] = useState<OccupancyReading[]>([]);
  const [readingsError, setReadingsError] = useState<string | null>(null);
  const [readingsLoading, setReadingsLoading] = useState(false);

  const [days, setDays] = useState('7');
  /**
   * Bumped to force the occupancy chart to re-fetch. A Retry button that set
   * the room to the value it already had would be a dead control: React bails
   * out of an identical state update, so the effect would never re-run.
   */
  const [readingsReload, setReadingsReload] = useState(0);

  /** Loads the three energy views plus the room list for the occupancy chart. */
  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    setTrendError(null);
    setByRoomError(null);
    setByDeviceError(null);

    const windowDays = Number(days) || 7;
    const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const [trendRes, roomRes, deviceRes, roomsRes] = await Promise.allSettled([
      energyService.trend({ days: windowDays }),
      energyService.byRoom({ from }),
      energyService.byDevice({ from }),
      occupancyService.current(),
    ]);

    if (trendRes.status === 'fulfilled') setTrend(trendRes.value);
    else setTrendError(reasonMessage(trendRes.reason, 'The energy trend could not be read.'));

    if (roomRes.status === 'fulfilled') setByRoom(roomRes.value);
    else setByRoomError(reasonMessage(roomRes.reason, 'Energy by room could not be read.'));

    if (deviceRes.status === 'fulfilled') setByDevice(deviceRes.value);
    else setByDeviceError(reasonMessage(deviceRes.reason, 'Energy by device could not be read.'));

    if (roomsRes.status === 'fulfilled') {
      setRooms(roomsRes.value.items);
      setSelectedRoom((current) => current || roomsRes.value.items[0]?.roomId || '');
    }

    const everythingFailed = [trendRes, roomRes, deviceRes, roomsRes].every(
      (result) => result.status === 'rejected'
    );
    if (everythingFailed) {
      setLoadError(
        reasonMessage(
          trendRes.status === 'rejected' ? trendRes.reason : null,
          'Unable to reach the backend, so no analytics could be loaded.'
        )
      );
      setStatus('error');
      return;
    }
    setStatus('success');
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  /** The occupancy chart reloads on its own when the selected room changes. */
  useEffect(() => {
    if (!selectedRoom) {
      setReadings([]);
      return;
    }
    let cancelled = false;
    setReadingsLoading(true);
    setReadingsError(null);
    const windowDays = Number(days) || 7;
    occupancyService
      .history({
        roomId: selectedRoom,
        from: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString(),
        limit: 200,
      })
      .then((result) => {
        if (cancelled) return;
        // Oldest first, so the x-axis reads left to right in time order.
        setReadings([...result.items].reverse());
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReadingsError(reasonMessage(err, 'The occupancy history could not be read.'));
      })
      .finally(() => {
        if (!cancelled) setReadingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoom, days, readingsReload]);

  const trendData = useMemo(
    () =>
      (trend?.days ?? []).map((day) => ({
        date: day.date,
        consumed: day.energyKwh,
        baseline: day.baselineKwh,
        saved: day.savedKwh,
      })),
    [trend]
  );

  const roomData = useMemo(
    () =>
      (byRoom?.rooms ?? [])
        // A room with no usable figure is excluded rather than plotted as a
        // zero bar that reads as "this room used no electricity".
        .filter((room) => room.contributingDevices > 0)
        .map((room) => ({
          roomId: room.roomId,
          consumed: room.energyKwh,
          saved: room.savedKwh,
        })),
    [byRoom]
  );

  const deviceData = useMemo(
    () =>
      (byDevice?.devices ?? [])
        .filter((device) => !device.insufficientData)
        .map((device) => ({
          name: device.name,
          consumed: device.energyKwh,
          saved: device.savedKwh,
        })),
    [byDevice]
  );

  const occupancyData = useMemo(
    () =>
      readings.map((reading) => ({
        at: formatDateTime(reading.timestamp),
        // NULL, not 0, for an unavailable or stale reading. Recharts leaves a
        // gap for null, which is exactly right: the line must not drop to the
        // floor and imply the room emptied.
        count: reading.count,
        status: reading.status,
      })),
    [readings]
  );

  const unknownReadings = readings.filter((reading) => reading.count === null).length;

  if (status === 'loading') return <LoadingState message="Loading analytics…" />;
  if (status === 'error') return <ErrorState message={loadError ?? undefined} onRetry={load} />;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Estimated energy trends and occupancy patterns, computed from persisted records."
        action={
          <div className="flex items-center gap-2">
            <Badge tone="info">ESTIMATED</Badge>
            {(byRoom?.simulated || byDevice?.simulated) && (
              <Badge tone="warning">SIMULATED DEVICES</Badge>
            )}
            <div className="w-36">
              <Select
                label="Window"
                name="analyticsWindow"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                options={[
                  { value: '7', label: 'Last 7 days' },
                  { value: '30', label: 'Last 30 days' },
                  { value: '90', label: 'Last 90 days' },
                ]}
              />
            </div>
          </div>
        }
      />

      {/* 1 ── Energy consumed vs baseline ───────────────────────── */}
      <Card>
        <CardHeader
          title="Estimated Energy: Consumed vs Baseline"
          description="One point per COMPLETED day, from the daily rollup. A day in progress is never rolled up."
        />
        <CardBody>
          {trendError ? (
            <ErrorState message={trendError} onRetry={load} />
          ) : trend?.insufficientData || trendData.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="No completed day has been rolled up yet"
              description={
                trend?.requires?.join(' · ') ??
                'The trend needs at least one full day of recorded device state. Today’s figures are on the Occupancy & Energy page in the meantime.'
              }
            />
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit=" kWh" />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="consumed"
                      name="Estimated consumed (kWh)"
                      stroke={COLOR.consumed}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="baseline"
                      name="Baseline (kWh)"
                      stroke={COLOR.baseline}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="saved"
                      name="Estimated saved (kWh)"
                      stroke={COLOR.saved}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {trend?.baseline && (
                <p className="mt-3 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
                  <strong>Baseline ({trend.baseline.source}):</strong> {trend.baseline.description}
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 2 ── Energy by room ────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Estimated Energy by Room"
            description={
              byRoom
                ? `${formatDateTime(byRoom.window.from)} → ${formatDateTime(byRoom.window.to)}`
                : 'Rooms with no usable figure are excluded, not plotted as zero.'
            }
          />
          <CardBody>
            {byRoomError ? (
              <ErrorState message={byRoomError} onRetry={load} />
            ) : byRoom?.insufficientData || roomData.length === 0 ? (
              <EmptyState
                icon={<DoorOpen className="h-6 w-6" />}
                title="Not enough data for a room breakdown"
                description={
                  byRoom?.requires?.join(' · ') ??
                  'No room has a device with both confirmed on/off history and a configured power rating in this window.'
                }
              />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={roomData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="roomId" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit=" kWh" />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="consumed" name="Estimated consumed (kWh)" fill={COLOR.consumed} />
                    <Bar dataKey="saved" name="Estimated saved (kWh)" fill={COLOR.saved} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        {/* 3 ── Energy by device ──────────────────────────────── */}
        <Card>
          <CardHeader
            title="Estimated Energy by Device"
            description="Configured wattage × measured on-duration. Devices without a rating are excluded."
          />
          <CardBody>
            {byDeviceError ? (
              <ErrorState message={byDeviceError} onRetry={load} />
            ) : byDevice?.insufficientData || deviceData.length === 0 ? (
              <EmptyState
                icon={<Zap className="h-6 w-6" />}
                title="Not enough data for a device breakdown"
                description={
                  byDevice?.requires?.join(' · ') ??
                  'No device has both confirmed on/off history and a configured power rating in this window.'
                }
              />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deviceData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit=" kWh" />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="consumed" name="Estimated consumed (kWh)" fill={COLOR.consumed} />
                    <Bar dataKey="saved" name="Estimated saved (kWh)" fill={COLOR.saved} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* 4 ── Occupancy over time ───────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          title="Occupancy Over Time"
          description="Persisted occupancy readings. Gaps are readings with no usable figure — never a count of zero."
          action={
            rooms.length > 0 ? (
              <div className="w-56">
                <Select
                  label="Room"
                  name="occupancyRoom"
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                  options={rooms.map((room) => ({
                    value: room.roomId,
                    label: `${room.name} (${room.roomId})`,
                  }))}
                />
              </div>
            ) : undefined
          }
        />
        <CardBody>
          {readingsError ? (
            <ErrorState message={readingsError} onRetry={() => setReadingsReload((n) => n + 1)} />
          ) : readingsLoading ? (
            <LoadingState message="Loading occupancy history…" />
          ) : rooms.length === 0 ? (
            <EmptyState
              icon={<DoorOpen className="h-6 w-6" />}
              title="No monitored rooms"
              description="Add a room on the Occupancy & Energy page and assign a camera to it. Occupancy history accumulates from that camera’s human detections."
            />
          ) : occupancyData.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No occupancy readings in this window"
              description="Readings are persisted on change and at the configured sampling interval, so a room that has never reported has no history yet. Start the room’s camera on Live Monitoring."
            />
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={occupancyData}
                    margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="at" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: unknown) => renderCount(value as number | null)}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="People counted"
                      stroke={COLOR.occupancy}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      // Leaves a GAP for a null reading rather than joining
                      // across it, so an outage is visible as an outage.
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {unknownReadings > 0 && (
                <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {unknownReadings} of {readings.length} readings in this window had no usable
                  figure (camera unavailable or data stale). They appear as gaps, not as zeros — an
                  unreadable camera is not an empty room.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** Pulls the normalized message off a rejected apiClient promise. */
function reasonMessage(reason: unknown, fallback: string): string {
  return (reason as { message?: string } | null)?.message ?? fallback;
}
