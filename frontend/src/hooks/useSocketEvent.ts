import { useEffect, useRef } from 'react';
import { getSocket } from '@/services/socket';

/**
 * Subscribes to a Socket.IO event for the lifetime of the component.
 * The latest handler is always used (via a ref) so callers don't need to
 * memoize their callback to avoid re-subscribing.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}
