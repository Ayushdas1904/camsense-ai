import { useCallback, useEffect, useState } from 'react';
import { systemService } from '@/services/systemService';
import type { BackendHealth, ViewStatus } from '@/types';

/**
 * Fetches backend + database health from /api/health. This is real data flow
 * (frontend → API → backend → DB status), so the dashboard's system-health
 * panel reflects the actual running system rather than a hardcoded value.
 */
export function useSystemHealth() {
  const [data, setData] = useState<BackendHealth | null>(null);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const health = await systemService.health();
      setData(health);
      setStatus('success');
    } catch (err) {
      setError((err as { message?: string }).message || 'AI system status unavailable.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, status, error, reload: load };
}
