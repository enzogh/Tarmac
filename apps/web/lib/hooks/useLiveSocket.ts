'use client';

import { useEffect, useRef } from 'react';
import { API_BASE, getCurrentWorkspaceId } from '../api';

export type LiveMessage = { type: string; payload: unknown };
type LiveHandler = (message: LiveMessage) => void;

const MAX_BACKOFF_MS = 30_000;

// Native browser WebSocket to the API's /live-ws endpoint (see
// apps/api/src/live/live.ws.ts). Auth rides on the same httpOnly session
// cookie already used for every other API call — no token to manage here.
// The connection is scoped to the current workspace at connect time (the
// server verifies access and only broadcasts events for that workspace back
// down this socket - see live.ws.ts) - switching workspace always does a
// hard navigation (full page reload, see workspace-context.tsx), so this
// hook remounting fresh on every workspace change is enough; no reactive
// reconnection logic needed here.
// Reconnects with exponential backoff on drop; the effect cleanup marks the
// socket as intentionally closed so a stale reconnect timer never fires
// after the consuming component unmounts.
export function useLiveSocket(onMessage: LiveHandler) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const workspaceId = getCurrentWorkspaceId();
    if (!workspaceId) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let backoffMs = 1000;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(
        `${API_BASE.replace(/^http/, 'ws')}/live-ws?workspaceId=${encodeURIComponent(workspaceId)}`,
      );

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
