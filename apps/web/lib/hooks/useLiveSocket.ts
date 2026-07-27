'use client';

import { useEffect, useRef } from 'react';
import { API_BASE } from '../api';

export type LiveMessage = { type: string; payload: unknown };
type LiveHandler = (message: LiveMessage) => void;

const MAX_BACKOFF_MS = 30_000;

// Native browser WebSocket to the API's /live-ws endpoint (see
// apps/api/src/live/live.ws.ts). Auth rides on the same httpOnly session
// cookie already used for every other API call — no token to manage here.
// Reconnects with exponential backoff on drop; the effect cleanup marks the
// socket as intentionally closed so a stale reconnect timer never fires
// after the consuming component unmounts.
export function useLiveSocket(onMessage: LiveHandler) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let backoffMs = 1000;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/live-ws`);

      socket.onopen = () => {
        backoffMs = 1000;
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data) as LiveMessage);
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
